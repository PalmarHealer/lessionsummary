import { db } from "./db";
import { newId } from "./ids";
import { bumpMaterial } from "./units";

export type JobKind = "transcribe" | "extract";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRow {
  id: string;
  file_id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  worker_id: string | null;
  lease_until: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const LEASE_SECONDS = 600;
/** After this many claims a job stays failed until someone retries it by hand. */
const MAX_ATTEMPTS = 3;

export function enqueueJob(fileId: string, kind: JobKind): string {
  const id = newId(12);
  const now = Date.now();
  db().prepare(`
    INSERT INTO jobs (id, file_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)
  `).run(id, fileId, kind, now, now);
  return id;
}

export interface ClaimedJob {
  job: JobRow;
  file: { id: string; name: string; mime: string; size: number; unit_id: string; options: string };
  unit: { title: string; subject: string };
}

/**
 * Hand the oldest open job to a worker. A running job whose lease ran out
 * counts as open again: the worker died (or the PC was switched off) and
 * nobody will ever complete it otherwise.
 */
export function claimJob(workerId: string, kinds: JobKind[]): ClaimedJob | null {
  if (!kinds.length) return null;
  const d = db();
  return d.transaction((): ClaimedJob | null => {
    const now = Date.now();
    d.prepare(`
      UPDATE jobs SET status = 'failed', error = COALESCE(error, 'Worker hat sich nicht mehr gemeldet'), updated_at = ?
      WHERE status = 'running' AND lease_until < ? AND attempts >= ?
    `).run(now, now, MAX_ATTEMPTS);
    const job = d.prepare(`
      SELECT * FROM jobs
      WHERE kind IN (${kinds.map(() => "?").join(",")})
        AND (status = 'queued' OR (status = 'running' AND lease_until < ?))
      ORDER BY created_at LIMIT 1
    `).get(...kinds, now) as JobRow | undefined;
    if (!job) return null;
    d.prepare(`
      UPDATE jobs SET status = 'running', worker_id = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `).run(workerId, now + LEASE_SECONDS * 1000, now, job.id);
    const file = d.prepare("SELECT id, name, mime, size, unit_id, options FROM files WHERE id = ?")
      .get(job.file_id) as ClaimedJob["file"];
    const unit = d.prepare("SELECT title, subject FROM units WHERE id = ?")
      .get(file.unit_id) as ClaimedJob["unit"];
    return { job: { ...job, status: "running", worker_id: workerId, attempts: job.attempts + 1 }, file, unit };
  }).immediate();
}

export const leaseSeconds = LEASE_SECONDS;

/** The job, if this worker still holds it. */
function heldJob(jobId: string, workerId: string): JobRow | null {
  const job = db().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  if (!job || job.status !== "running" || job.worker_id !== workerId) return null;
  return job;
}

export function heartbeat(jobId: string, workerId: string): boolean {
  if (!heldJob(jobId, workerId)) return false;
  db().prepare("UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ?")
    .run(Date.now() + LEASE_SECONDS * 1000, Date.now(), jobId);
  return true;
}

export interface TranscriptResult {
  language?: string;
  duration?: number;
  model?: string;
  diarized?: boolean;
  speakers?: string[];
  segments: Array<{ start: number; end: number; speaker: string | null; text: string }>;
}

export interface ExtractResult {
  text: string;
  pages?: number | null;
  meta?: Record<string, unknown>;
}

export function completeJob(jobId: string, workerId: string, result: unknown): boolean {
  const d = db();
  return d.transaction(() => {
    const job = heldJob(jobId, workerId);
    if (!job) return false;
    const file = d.prepare("SELECT unit_id FROM files WHERE id = ?").get(job.file_id) as { unit_id: string } | undefined;
    if (!file) return false;

    if (job.kind === "transcribe") {
      const r = result as TranscriptResult;
      if (!Array.isArray(r?.segments)) throw new Error("result.segments missing");
      const segments = r.segments.map((s) => ({
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        speaker: s.speaker ?? null,
        text: String(s.text ?? "").trim(),
      })).filter((s) => s.text);
      // Keep names someone already gave the speakers when a file is re-run.
      const prev = d.prepare("SELECT speakers FROM transcripts WHERE file_id = ?").get(job.file_id) as { speakers: string } | undefined;
      d.prepare(`
        INSERT OR REPLACE INTO transcripts (file_id, language, duration, model, diarized, segments, speakers, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.file_id, r.language ?? null, r.duration ?? null, r.model ?? null, r.diarized ? 1 : 0,
        JSON.stringify(segments), prev?.speakers ?? "{}", Date.now());
    } else {
      const r = result as ExtractResult;
      if (typeof r?.text !== "string") throw new Error("result.text missing");
      d.prepare("UPDATE files SET extracted_text = ?, extract_meta = ? WHERE id = ?")
        .run(r.text, JSON.stringify({ pages: r.pages ?? null, ...(r.meta ?? {}) }), job.file_id);
    }
    d.prepare("UPDATE jobs SET status = 'done', error = NULL, lease_until = NULL, updated_at = ? WHERE id = ?")
      .run(Date.now(), jobId);
    bumpMaterial(file.unit_id);
    return true;
  })();
}

export function failJob(jobId: string, workerId: string, error: string, retryable: boolean): boolean {
  const job = heldJob(jobId, workerId);
  if (!job) return false;
  const requeue = retryable && job.attempts < MAX_ATTEMPTS;
  db().prepare("UPDATE jobs SET status = ?, error = ?, lease_until = NULL, worker_id = NULL, updated_at = ? WHERE id = ?")
    .run(requeue ? "queued" : "failed", error.slice(0, 2000), Date.now(), jobId);
  return true;
}

/** Put a file back in the queue, e.g. after a failure or to re-transcribe with other settings. */
export function retryFile(fileId: string, kind: JobKind): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM jobs WHERE file_id = ? AND status IN ('queued', 'failed', 'done')").run(fileId);
    const running = d.prepare("SELECT 1 FROM jobs WHERE file_id = ? AND status = 'running'").get(fileId);
    if (!running) enqueueJob(fileId, kind);
  })();
}

/** Latest job per file of a unit, for the status badges. */
export function jobsForUnit(unitId: string): Map<string, JobRow> {
  const rows = db().prepare(`
    SELECT j.* FROM jobs j JOIN files f ON f.id = j.file_id
    WHERE f.unit_id = ? ORDER BY j.created_at
  `).all(unitId) as JobRow[];
  return new Map(rows.map((j) => [j.file_id, j]));
}

export function queueStats(): { queued: number; running: number; failed: number } {
  const r = db().prepare(`
    SELECT
      SUM(status = 'queued') AS queued,
      SUM(status = 'running') AS running,
      SUM(status = 'failed') AS failed
    FROM jobs
  `).get() as { queued: number | null; running: number | null; failed: number | null };
  return { queued: r.queued ?? 0, running: r.running ?? 0, failed: r.failed ?? 0 };
}

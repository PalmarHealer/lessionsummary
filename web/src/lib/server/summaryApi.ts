/**
 * The operations behind both the REST summary API (/api/v1) and the MCP
 * endpoint (/mcp), so a scheduled Claude task and a script see the same thing.
 */
import { db } from "./db";
import { getFile, listFiles, type FileRow } from "./files";
import { jobsForUnit } from "./jobs";
import type { ApiCaller } from "./tokens";
import { fmtTime, speakerName, transcriptText, transcriptsForUnit } from "./transcripts";
import { getUnit, saveSummary, type Unit } from "./units";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Keeps one oversized spreadsheet from pushing everything else out of the context window. */
const MAX_DOC_CHARS = 60_000;

function mayAccess(caller: ApiCaller, unit: Unit | null): unit is Unit {
  return !!unit && (caller.kind === "admin" || unit.owner_id === caller.userId);
}

function unitFor(caller: ApiCaller, id: string): Unit {
  const unit = getUnit(id);
  if (!mayAccess(caller, unit)) throw new ApiError(404, "not_found", `Einheit ${id} nicht gefunden`);
  return unit;
}

export interface PendingUnit {
  id: string;
  title: string;
  subject: string;
  date: string | null;
  material_rev: number;
  has_summary: boolean;
  processing_jobs: number;
}

/**
 * Units whose summary is missing or older than their material. Units still
 * waiting on a transcription are left out — summarising half the material
 * would only have to be redone once the worker is through.
 */
export function pendingUnits(caller: ApiCaller): { units: PendingUnit[]; waiting_for_processing: number } {
  const rows = db().prepare(`
    SELECT u.id, u.title, u.subject, u.held_on AS date, u.material_rev, u.summary_md IS NOT NULL AS has_summary,
      (SELECT COUNT(*) FROM jobs j JOIN files f ON f.id = j.file_id
         WHERE f.unit_id = u.id AND j.status IN ('queued', 'running')) AS processing_jobs
    FROM units u
    WHERE u.summary_rev < u.material_rev AND (? IS NULL OR u.owner_id = ?)
    ORDER BY u.updated_at
  `).all(caller.kind === "user" ? caller.userId : null, caller.kind === "user" ? caller.userId : null) as
    Array<Omit<PendingUnit, "has_summary"> & { has_summary: number }>;
  const units = rows.map((r) => ({ ...r, has_summary: r.has_summary === 1 }));
  return {
    units: units.filter((u) => u.processing_jobs === 0),
    waiting_for_processing: units.filter((u) => u.processing_jobs > 0).length,
  };
}

export function listUnits(caller: ApiCaller, q: string, limit: number) {
  const like = `%${q.trim()}%`;
  return db().prepare(`
    SELECT id, title, subject, held_on AS date, summary_md IS NOT NULL AS has_summary, summary_rev < material_rev AS summary_due
    FROM units
    WHERE (? IS NULL OR owner_id = ?) AND (? = '%%' OR title LIKE ? OR subject LIKE ? OR summary_md LIKE ?)
    ORDER BY COALESCE(held_on, date(created_at / 1000, 'unixepoch')) DESC LIMIT ?
  `).all(
    caller.kind === "user" ? caller.userId : null, caller.kind === "user" ? caller.userId : null,
    like, like, like, like, Math.min(Math.max(limit, 1), 200),
  );
}

/** Pages and slides ("## Folie 3") belong under the document's own heading. */
function demoteHeadings(md: string): string {
  return md.replace(/^(#{1,5}) /gm, "#$1 ");
}

function fileLine(f: FileRow, status: string): string {
  return `- \`${f.id}\` · ${f.kind} · ${f.name} (${Math.round(f.size / 1024)} KB)${status ? ` · ${status}` : ""}`;
}

/** Everything a summary can be built from, as one Markdown document. */
export function unitContextMarkdown(caller: ApiCaller, id: string): { markdown: string; unit: Unit; files: FileRow[] } {
  const unit = unitFor(caller, id);
  const files = listFiles(unit.id);
  const jobs = jobsForUnit(unit.id);
  const transcripts = transcriptsForUnit(unit.id);

  const out: string[] = [];
  out.push(`# ${unit.title}`, "");
  out.push(`- Einheit: \`${unit.id}\``);
  if (unit.subject) out.push(`- Fach: ${unit.subject}`);
  if (unit.held_on) out.push(`- Datum: ${unit.held_on}`);
  out.push(`- material_rev: ${unit.material_rev} (beim Einreichen der Zusammenfassung mitschicken)`, "");

  if (unit.notes.trim()) out.push("## Eigene Notizen", "", unit.notes.trim(), "");

  out.push("## Dateien", "");
  if (!files.length) out.push("_Keine Dateien._");
  for (const f of files) {
    const job = jobs.get(f.id);
    const status = job && job.status !== "done" ? `Verarbeitung: ${job.status}${job.error ? ` (${job.error})` : ""}` : "";
    out.push(fileLine(f, status));
  }
  out.push("");

  for (const f of files) {
    if (f.kind === "document" && f.extracted_text) {
      const text = f.extracted_text.length > MAX_DOC_CHARS
        ? `${f.extracted_text.slice(0, MAX_DOC_CHARS)}\n\n_[… gekürzt, ${f.extracted_text.length} Zeichen insgesamt]_`
        : f.extracted_text;
      out.push(`## Dokument: ${f.name}`, "", demoteHeadings(text.trim()), "");
    }
  }

  for (const f of files) {
    const t = transcripts.get(f.id);
    if (f.kind !== "audio" || !t) continue;
    const speakers = [...new Set(t.segments.map((s) => s.speaker).filter(Boolean))] as string[];
    out.push(`## Transkript: ${f.name}`, "");
    out.push(`Dauer ${fmtTime(t.duration ?? 0)} · Sprache ${t.language ?? "?"}${t.diarized
      ? ` · Sprecher: ${speakers.map((s) => speakerName(t, s)).join(", ")}`
      : " · ohne Sprechererkennung"}`, "");
    out.push(transcriptText(t), "");
  }

  const images = files.filter((f) => f.kind === "image" || (f.kind === "document" && f.mime === "application/pdf"));
  if (images.length) {
    out.push("## Bilder und PDFs zum Ansehen", "", "Mit `get_file` abrufen (Tafelbilder, Folien, Arbeitsblätter):", "");
    for (const f of images) out.push(`- \`${f.id}\` ${f.name}`);
    out.push("");
  }

  if (unit.summary_md) {
    out.push("## Bisherige Zusammenfassung", "", `_(Stand material_rev ${unit.summary_rev}, ${unit.summary_by === "manual" ? "von Hand bearbeitet" : "automatisch"})_`, "", unit.summary_md, "");
  }
  return { markdown: out.join("\n"), unit, files };
}

export function fileFor(caller: ApiCaller, fileId: string): FileRow {
  const f = getFile(fileId);
  if (!f || !mayAccess(caller, getUnit(f.unit_id))) throw new ApiError(404, "not_found", `Datei ${fileId} nicht gefunden`);
  return f;
}

export function submitSummary(caller: ApiCaller, id: string, materialRev: number, markdown: string): { status: "saved"; summary_due: boolean } {
  const unit = unitFor(caller, id);
  if (!markdown.trim()) throw new ApiError(400, "empty", "Die Zusammenfassung ist leer.");
  if (!Number.isInteger(materialRev) || materialRev > unit.material_rev) {
    throw new ApiError(400, "bad_rev", `material_rev muss eine Zahl ≤ ${unit.material_rev} sein.`);
  }
  if (materialRev < unit.material_rev) {
    throw new ApiError(409, "stale", `Das Material hat sich seitdem geändert (jetzt material_rev ${unit.material_rev}). Kontext neu laden.`);
  }
  if (unit.summary_by === "manual" && unit.summary_rev >= materialRev) {
    throw new ApiError(409, "manual", "Die Zusammenfassung wurde von Hand bearbeitet und ist aktuell – nicht überschreiben.");
  }
  saveSummary(unit.id, markdown, "api", materialRev);
  return { status: "saved", summary_due: false };
}

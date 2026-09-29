import type { RequestHandler } from "./$types";
import { withWorker } from "$lib/server/http";
import { claimJob, leaseSeconds, type JobKind } from "$lib/server/jobs";

/** POST /api/worker/claim {"worker_id", "kinds": ["transcribe", "extract"]} → 200 job | 204 */
export const POST: RequestHandler = async ({ request }) =>
  withWorker(request, async () => {
    const body = (await request.json().catch(() => ({}))) as { worker_id?: string; kinds?: string[] };
    const workerId = String(body.worker_id ?? "").slice(0, 100);
    if (!workerId) return Response.json({ error: "worker_id required" }, { status: 400 });
    const kinds = (body.kinds ?? []).filter((k): k is JobKind => k === "transcribe" || k === "extract");

    const claimed = claimJob(workerId, kinds);
    if (!claimed) return new Response(null, { status: 204 });
    const { job, file, unit } = claimed;
    const opts = JSON.parse(file.options || "{}") as { language?: string; min_speakers?: number; max_speakers?: number };

    // The unit's title and subject prime Whisper with the lesson's vocabulary
    // ("Photosynthese", "Weimarer Republik"), which it otherwise tends to mishear.
    const prompt = [unit.subject, unit.title].filter(Boolean).join(": ");
    return Response.json({
      job: {
        id: job.id,
        kind: job.kind,
        file: { id: file.id, name: file.name, mime: file.mime, size: file.size },
        download_url: `/api/worker/files/${file.id}`,
        options: {
          language: opts.language || null,
          min_speakers: opts.min_speakers || null,
          max_speakers: opts.max_speakers || null,
          initial_prompt: prompt || null,
        },
      },
      lease_seconds: leaseSeconds,
    });
  });

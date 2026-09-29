import type { RequestHandler } from "./$types";
import { withWorker } from "$lib/server/http";
import { completeJob, failJob, heartbeat, leaseSeconds } from "$lib/server/jobs";

/**
 * POST /api/worker/jobs/:id/heartbeat | complete | fail
 * 409 means the worker no longer holds the job (lease expired and someone
 * else took it, or the file was deleted) — it must drop its result.
 */
export const POST: RequestHandler = async ({ request, params }) =>
  withWorker(request, async () => {
    const body = (await request.json().catch(() => ({}))) as {
      worker_id?: string; result?: unknown; error?: string; retryable?: boolean;
    };
    const workerId = String(body.worker_id ?? "");
    const lost = () => Response.json({ error: "lease_lost" }, { status: 409 });

    switch (params.action) {
      case "heartbeat":
        return heartbeat(params.id, workerId) ? Response.json({ lease_seconds: leaseSeconds }) : lost();
      case "complete":
        try {
          return completeJob(params.id, workerId, body.result) ? Response.json({ ok: true }) : lost();
        } catch (err) {
          return Response.json({ error: "bad_result", message: (err as Error).message }, { status: 400 });
        }
      case "fail":
        return failJob(params.id, workerId, String(body.error ?? "unknown error"), body.retryable === true)
          ? Response.json({ ok: true })
          : lost();
      default:
        return Response.json({ error: "unknown action" }, { status: 404 });
    }
  });

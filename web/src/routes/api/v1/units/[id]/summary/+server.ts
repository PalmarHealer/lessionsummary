import type { RequestHandler } from "./$types";
import { withCaller } from "$lib/server/http";
import { ApiError, submitSummary } from "$lib/server/summaryApi";

/** PUT /api/v1/units/:id/summary  {"markdown": "…", "material_rev": 3} */
export const PUT: RequestHandler = async ({ request, params }) =>
  withCaller(request, async (caller) => {
    const body = (await request.json().catch(() => null)) as { markdown?: unknown; material_rev?: unknown } | null;
    if (!body || typeof body.markdown !== "string") throw new ApiError(400, "bad_request", "markdown fehlt");
    return Response.json(submitSummary(caller, params.id, Number(body.material_rev), body.markdown));
  });

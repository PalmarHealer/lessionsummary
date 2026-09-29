import type { RequestHandler } from "./$types";
import { withCaller } from "$lib/server/http";
import { listUnits, pendingUnits } from "$lib/server/summaryApi";

/**
 * GET /api/v1/units?summary=pending  → units due for a (new) summary
 * GET /api/v1/units?q=…&limit=…      → search
 */
export const GET: RequestHandler = async ({ request, url }) =>
  withCaller(request, (caller) => {
    if (url.searchParams.get("summary") === "pending") return Response.json(pendingUnits(caller));
    return Response.json({
      units: listUnits(caller, url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 50)),
    });
  });

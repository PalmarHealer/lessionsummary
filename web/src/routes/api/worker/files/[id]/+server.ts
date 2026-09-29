import type { RequestHandler } from "./$types";
import { fileResponse, getFile } from "$lib/server/files";
import { withWorker } from "$lib/server/http";

export const GET: RequestHandler = async ({ request, params }) =>
  withWorker(request, () => {
    const f = getFile(params.id);
    if (!f) return Response.json({ error: "not_found" }, { status: 404 });
    return fileResponse(f, request);
  });

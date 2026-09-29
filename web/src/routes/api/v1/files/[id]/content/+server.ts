import type { RequestHandler } from "./$types";
import { fileResponse } from "$lib/server/files";
import { withCaller } from "$lib/server/http";
import { fileFor } from "$lib/server/summaryApi";

export const GET: RequestHandler = async ({ request, params }) =>
  withCaller(request, (caller) => fileResponse(fileFor(caller, params.id), request));

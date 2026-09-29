import { ApiError } from "./summaryApi";
import { apiCaller, isWorker, type ApiCaller } from "./tokens";

/** Run a summary-API handler with Bearer auth and uniform JSON errors. */
export async function withCaller(request: Request, fn: (caller: ApiCaller) => Response | Promise<Response>): Promise<Response> {
  const caller = apiCaller(request);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await fn(caller);
  } catch (err) {
    if (err instanceof ApiError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}

export async function withWorker(request: Request, fn: () => Response | Promise<Response>): Promise<Response> {
  if (!isWorker(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return fn();
}

import type { RequestHandler } from "./$types";
import { handleMcp } from "$lib/server/mcp";
import { apiCaller } from "$lib/server/tokens";

function unauthorized(): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "API-Token fehlt oder ist ungültig (Einstellungen → API-Tokens)" } },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="lessionsummary"' } },
  );
}

export const POST: RequestHandler = async ({ request }) => {
  const caller = apiCaller(request);
  if (!caller) return unauthorized();
  return handleMcp(caller, request);
};

// Stateless server: no SSE stream to open, no session to end.
export const GET: RequestHandler = async () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const DELETE: RequestHandler = async () => new Response(null, { status: 405, headers: { allow: "POST" } });

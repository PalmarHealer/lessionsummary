/**
 * Minimal MCP server (Streamable HTTP, stateless, plain JSON responses).
 *
 * Hand-rolled instead of the SDK: the SDK's HTTP transport wants Node's
 * req/res, SvelteKit hands us a web Request — and four tools don't need
 * sessions, SSE or resumability. Every POST is one self-contained JSON-RPC
 * exchange, which is all a scheduled Claude task does anyway.
 */
import { readFileSync } from "node:fs";
import { filePath } from "./files";
import { ApiError, fileFor, listUnits, pendingUnits, submitSummary, unitContextMarkdown } from "./summaryApi";
import type { ApiCaller } from "./tokens";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Claude rejects larger images; beyond this we point to the extracted text instead. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const INLINE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const INSTRUCTIONS = `LessionSummary hält Unterrichtseinheiten mit Audio-Transkripten (mit Sprechererkennung), Dokumenten und Bildern.
Ablauf für Zusammenfassungen: list_pending_units → für jede Einheit get_unit_context → bei Bedarf get_file für Bilder → submit_summary mit der material_rev aus dem Kontext.
Zusammenfassungen auf Deutsch in Markdown, nichts erfinden, was nicht im Material steht.`;

const TOOLS = [
  {
    name: "list_pending_units",
    description: "Einheiten, deren Zusammenfassung fehlt oder veraltet ist und deren Material fertig verarbeitet ist.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_units",
    description: "Einheiten durchsuchen (Titel, Fach, Zusammenfassung). Ohne query die neuesten.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchbegriff" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 30 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_unit_context",
    description: "Das gesamte Material einer Einheit als Markdown: Metadaten, Notizen, Dokumenttexte, Transkripte mit Sprechern, Dateiliste, bisherige Zusammenfassung und die aktuelle material_rev.",
    inputSchema: {
      type: "object",
      properties: { unit_id: { type: "string" } },
      required: ["unit_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_file",
    description: "Eine Datei der Einheit abrufen. Bilder kommen als Bild, Dokumente als extrahierter Text.",
    inputSchema: {
      type: "object",
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "submit_summary",
    description: "Die Haupt-Zusammenfassung (Markdown) einer Einheit speichern. material_rev ist die aus get_unit_context; ist sie veraltet, wird abgelehnt und der Kontext muss neu geladen werden.",
    inputSchema: {
      type: "object",
      properties: {
        unit_id: { type: "string" },
        material_rev: { type: "integer" },
        markdown: { type: "string" },
      },
      required: ["unit_id", "material_rev", "markdown"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function text(t: string): { content: Content[] } {
  return { content: [{ type: "text", text: t }] };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new ApiError(400, "bad_args", `${key} fehlt`);
  return v;
}

function callTool(caller: ApiCaller, name: string, args: Record<string, unknown>): { content: Content[] } {
  switch (name) {
    case "list_pending_units":
      return text(JSON.stringify(pendingUnits(caller), null, 2));
    case "list_units":
      return text(JSON.stringify(listUnits(caller, String(args.query ?? ""), Number(args.limit ?? 30)), null, 2));
    case "get_unit_context":
      return text(unitContextMarkdown(caller, str(args, "unit_id")).markdown);
    case "get_file": {
      const f = fileFor(caller, str(args, "file_id"));
      if (f.kind === "image") {
        if (!INLINE_IMAGE_MIME.has(f.mime)) return text(`${f.name}: Format ${f.mime} kann nicht direkt angezeigt werden.`);
        if (f.size > MAX_IMAGE_BYTES) return text(`${f.name} ist mit ${Math.round(f.size / 1048576)} MB zu groß zum Anzeigen.`);
        return {
          content: [
            { type: "text", text: f.name },
            { type: "image", data: readFileSync(filePath(f)).toString("base64"), mimeType: f.mime },
          ],
        };
      }
      if (f.extracted_text) return text(`# ${f.name}\n\n${f.extracted_text}`);
      return text(`${f.name} (${f.kind}, ${f.mime}): kein Text verfügbar${f.kind === "audio" ? " – das Transkript steht in get_unit_context" : ""}.`);
    }
    case "submit_summary": {
      const rev = Number(args.material_rev);
      const r = submitSummary(caller, str(args, "unit_id"), rev, str(args, "markdown"));
      return text(JSON.stringify(r));
    }
    default:
      throw new RpcError(-32602, `Unbekanntes Tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

function handleOne(caller: ApiCaller, req: RpcRequest): unknown {
  switch (req.method) {
    case "initialize": {
      const asked = String(req.params?.protocolVersion ?? "");
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lessionsummary", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return callTool(caller, name, args);
      } catch (err) {
        if (err instanceof RpcError) throw err;
        // Tool failures go back as results with isError, so the model can read
        // the reason (e.g. "stale") and react instead of the call just dying.
        const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${req.method}`);
  }
}

function respond(caller: ApiCaller, req: RpcRequest): object | null {
  // Notifications (no id) get no answer.
  if (req.id === undefined || req.id === null) return null;
  try {
    return { jsonrpc: "2.0", id: req.id, result: handleOne(caller, req) };
  } catch (err) {
    const code = err instanceof RpcError ? err.code : -32603;
    return { jsonrpc: "2.0", id: req.id, error: { code, message: (err as Error).message } };
  }
}

export async function handleMcp(caller: ApiCaller, request: Request): Promise<Response> {
  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const replies = (Array.isArray(body) ? body : [body]).map((r) => respond(caller, r)).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

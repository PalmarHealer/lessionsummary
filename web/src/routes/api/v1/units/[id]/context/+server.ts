import type { RequestHandler } from "./$types";
import { withCaller } from "$lib/server/http";
import { unitContextMarkdown } from "$lib/server/summaryApi";

/** GET /api/v1/units/:id/context[?format=json] — all material, Markdown by default. */
export const GET: RequestHandler = async ({ request, params, url }) =>
  withCaller(request, (caller) => {
    const { markdown, unit, files } = unitContextMarkdown(caller, params.id);
    if (url.searchParams.get("format") === "json") {
      return Response.json({
        unit: {
          id: unit.id, title: unit.title, subject: unit.subject, date: unit.held_on,
          material_rev: unit.material_rev, summary_rev: unit.summary_rev, summary: unit.summary_md,
        },
        files: files.map((f) => ({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size })),
        markdown,
      });
    }
    return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  });

import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { storeUpload, UploadTooLarge } from "$lib/server/files";
import { accessFor, getUnit } from "$lib/server/units";

/**
 * POST /units/:id/upload?name=…[&language=de&min_speakers=2&max_speakers=5]
 * Body is the raw file. Not multipart: the browser sends one request per file
 * and we stream it to disk without parsing a form around it.
 */
export const POST: RequestHandler = async ({ params, locals, request, url }) => {
  const unit = getUnit(params.id);
  if (!unit || !accessFor(unit, locals.user).edit) throw error(404, "Einheit nicht gefunden");
  if (!request.body) throw error(400, "Leerer Upload");

  const name = (url.searchParams.get("name") ?? "").replace(/[\\/\0]/g, "_").trim().slice(0, 200) || "upload";
  const int = (k: string) => {
    const n = Number(url.searchParams.get(k));
    return Number.isInteger(n) && n > 0 && n <= 20 ? n : null;
  };
  const language = (url.searchParams.get("language") ?? "").trim().slice(0, 8) || null;

  try {
    const f = await storeUpload(unit.id, name, request.headers.get("content-type") ?? "", request.body, {
      language,
      min_speakers: int("min_speakers"),
      max_speakers: int("max_speakers"),
    });
    return Response.json({ id: f.id, kind: f.kind, name: f.name, size: f.size });
  } catch (err) {
    if (err instanceof UploadTooLarge) return Response.json({ error: err.message }, { status: 413 });
    throw err;
  }
};

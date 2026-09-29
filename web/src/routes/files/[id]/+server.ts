import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { fileResponse, getFile } from "$lib/server/files";
import { accessFor, getUnit } from "$lib/server/units";

/** Files for the browser: inline for previews and the audio player, ?download for saving. */
export const GET: RequestHandler = async ({ params, locals, request, url }) => {
  const f = getFile(params.id);
  const unit = f ? getUnit(f.unit_id) : null;
  if (!f || !unit || !accessFor(unit, locals.user).materials) throw error(404, "Datei nicht gefunden");
  return fileResponse(f, request, { download: url.searchParams.has("download") });
};

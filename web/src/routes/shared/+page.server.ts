import type { PageServerLoad } from "./$types";
import { listSharedWith } from "$lib/server/units";

export const load: PageServerLoad = async ({ locals, url }) => {
  const q = url.searchParams.get("q") ?? "";
  return { units: listSharedWith(locals.user!, q), q, schools: locals.user!.schools };
};

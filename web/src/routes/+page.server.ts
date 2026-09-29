import type { PageServerLoad } from "./$types";
import { listOwnUnits } from "$lib/server/units";

export const load: PageServerLoad = async ({ locals, url }) => {
  const q = url.searchParams.get("q") ?? "";
  return { units: listOwnUnits(locals.user!.id, q), q };
};

import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { config } from "$lib/server/env";
import { queueStats } from "$lib/server/jobs";
import { createToken, listTokens, revokeToken } from "$lib/server/tokens";

export const load: PageServerLoad = async ({ locals }) => {
  return {
    tokens: listTokens(locals.user!.id),
    origin: config.origin,
    queue: queueStats(),
    schools: locals.user!.schools,
    classes: locals.user!.classes,
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const name = String((await request.formData()).get("name") ?? "").trim();
    if (!name) return fail(400, { error: "Name fehlt" });
    return { token: createToken(locals.user!.id, name), name };
  },
  revoke: async ({ locals, request }) => {
    revokeToken(locals.user!.id, String((await request.formData()).get("id") ?? ""));
    return { revoked: true };
  },
};

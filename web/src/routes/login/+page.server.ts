import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { config } from "$lib/server/env";

export const load: PageServerLoad = async ({ locals, url }) => {
  const next = url.searchParams.get("next") ?? "/";
  if (locals.user) throw redirect(303, next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return {
    next,
    error: url.searchParams.get("error"),
    configured: !!config.opensaxUrl && !!config.clientSecret,
    devLogin: config.devLogin,
  };
};

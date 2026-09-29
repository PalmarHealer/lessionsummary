import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { beginLogin } from "$lib/server/auth";

export const GET: RequestHandler = async ({ cookies, url }) => {
  throw redirect(303, beginLogin(cookies, url.searchParams.get("next") ?? "/"));
};

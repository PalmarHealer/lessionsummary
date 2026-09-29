import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { completeLogin, createSession, LoginError } from "$lib/server/auth";

export const GET: RequestHandler = async ({ cookies, url }) => {
  let target: string;
  try {
    const { user, next } = await completeLogin(cookies, url);
    createSession(cookies, user.id);
    target = next;
  } catch (err) {
    if (!(err instanceof LoginError)) console.error("[auth] callback failed", err);
    const msg = err instanceof LoginError ? err.message : "Anmeldung fehlgeschlagen.";
    target = `/login?error=${encodeURIComponent(msg)}`;
  }
  throw redirect(303, target);
};

import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createSession, upsertUser } from "$lib/server/auth";
import { config } from "$lib/server/env";
import { sha256Hex } from "$lib/server/ids";

/** Local development without an OpenSax instance. Disabled in production builds. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!config.devLogin) throw error(404);
  const data = await request.formData();
  const name = String(data.get("name") ?? "").trim() || "Test";
  const school = String(data.get("school") ?? "").trim();
  const user = upsertUser({
    sub: `dev-${sha256Hex(name).slice(0, 16)}`,
    name,
    schools: school ? [{ id: `dev-school-${sha256Hex(school).slice(0, 8)}`, name: school }] : [],
    classes: [],
  });
  createSession(cookies, user.id);
  const next = String(data.get("next") ?? "/");
  throw redirect(303, next.startsWith("/") && !next.startsWith("//") ? next : "/");
};

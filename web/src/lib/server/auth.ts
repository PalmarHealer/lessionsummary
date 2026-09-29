import { createHash, randomBytes } from "node:crypto";
import type { Cookies } from "@sveltejs/kit";
import { db } from "./db";
import { config } from "./env";
import { sha256Hex } from "./ids";

export const SESSION_COOKIE = "ls_sid";
const OAUTH_COOKIE = "ls_oauth";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  name: string;
  schools: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
}

/** What `/oauth/userinfo` on OpenSax answers with the scopes we ask for. */
interface OpenSaxClaims {
  sub: string;
  name?: string;
  schools?: Array<{ id: string; name: string }>;
  classes?: Array<{ id: string; name: string }>;
}

function secureCookies(): boolean {
  return config.origin.startsWith("https://");
}

// ── OAuth against OpenSax ───────────────────────────────────────────────

/** Start the authorization-code flow; returns the URL to send the browser to. */
export function beginLogin(cookies: Cookies, next: string): string {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), {
    path: "/auth",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: 600,
  });
  const u = new URL(`${config.opensaxUrl}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", `${config.origin}/auth/callback`);
  u.searchParams.set("scope", "openid profile school");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export class LoginError extends Error {}

/**
 * Finish the flow: check state, trade the code for a token, ask OpenSax who
 * the user is. The token is only good for that one question, so it is not
 * kept — our own session takes over from here.
 */
export async function completeLogin(cookies: Cookies, url: URL): Promise<{ user: User; next: string }> {
  const raw = cookies.get(OAUTH_COOKIE);
  cookies.delete(OAUTH_COOKIE, { path: "/auth" });
  if (!raw) throw new LoginError("Anmeldung abgelaufen – bitte erneut versuchen.");
  const saved = JSON.parse(raw) as { state: string; verifier: string; next: string };

  const err = url.searchParams.get("error");
  if (err) throw new LoginError(err === "access_denied" ? "Anmeldung abgelehnt." : `OpenSax meldet: ${err}`);
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== saved.state) {
    throw new LoginError("Ungültige Antwort von OpenSax.");
  }

  const tokenRes = await fetch(`${config.opensaxUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.origin}/auth/callback`,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) throw new LoginError(`Token-Austausch fehlgeschlagen (${tokenRes.status}).`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const infoRes = await fetch(`${config.opensaxUrl}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new LoginError(`Profil konnte nicht geladen werden (${infoRes.status}).`);
  const claims = (await infoRes.json()) as OpenSaxClaims;
  if (!claims.sub) throw new LoginError("OpenSax hat keine Benutzerkennung geliefert.");

  const next = saved.next.startsWith("/") && !saved.next.startsWith("//") ? saved.next : "/";
  return { user: upsertUser(claims), next };
}

export function upsertUser(claims: OpenSaxClaims): User {
  const now = Date.now();
  const user: User = {
    id: claims.sub,
    name: claims.name?.trim() || "Unbekannt",
    schools: claims.schools ?? [],
    classes: claims.classes ?? [],
  };
  const d = db();
  d.transaction(() => {
    d.prepare(
      `INSERT INTO users (id, name, created_at, last_login) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_login = excluded.last_login`,
    ).run(user.id, user.name, now, now);
    // Memberships are replaced wholesale: someone who changed schools must
    // lose access to the old school's shared summaries.
    d.prepare("DELETE FROM user_groups WHERE user_id = ?").run(user.id);
    const ins = d.prepare("INSERT INTO user_groups (user_id, group_id, name, kind) VALUES (?, ?, ?, ?)");
    for (const s of user.schools) ins.run(user.id, s.id, s.name, "school");
    for (const c of user.classes) ins.run(user.id, c.id, c.name, "class");
  })();
  return user;
}

// ── Sessions ────────────────────────────────────────────────────────────

export function createSession(cookies: Cookies, userId: string): void {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256Hex(token), userId, now, now + SESSION_DAYS * 86_400_000);
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function destroySession(cookies: Cookies): void {
  const token = cookies.get(SESSION_COOKIE);
  if (token) db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256Hex(token));
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export function loadUser(userId: string): User | null {
  const row = db().prepare("SELECT id, name FROM users WHERE id = ?").get(userId) as { id: string; name: string } | undefined;
  if (!row) return null;
  const groups = db().prepare("SELECT group_id AS id, name, kind FROM user_groups WHERE user_id = ? ORDER BY name")
    .all(userId) as Array<{ id: string; name: string; kind: string }>;
  return {
    id: row.id,
    name: row.name,
    schools: groups.filter((g) => g.kind === "school").map(({ id, name }) => ({ id, name })),
    classes: groups.filter((g) => g.kind === "class").map(({ id, name }) => ({ id, name })),
  };
}

export function userForSession(token: string | undefined): User | null {
  if (!token) return null;
  const row = db().prepare("SELECT user_id, expires_at FROM sessions WHERE id_hash = ?")
    .get(sha256Hex(token)) as { user_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return loadUser(row.user_id);
}

import { randomBytes } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { config } from "./env";
import { newId, sha256Hex } from "./ids";

export interface ApiToken {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

const PREFIX = "lss_";

/** Returns the plain token exactly once; only its hash is stored. */
export function createToken(userId: string, name: string): string {
  const token = PREFIX + randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(9), userId, name.trim().slice(0, 80) || "Token", sha256Hex(token), Date.now());
  return token;
}

export function listTokens(userId: string): ApiToken[] {
  return db().prepare("SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as ApiToken[];
}

export function revokeToken(userId: string, id: string): void {
  db().prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? m[1]!.trim() : null;
}

/**
 * Who is calling the summary API / MCP. A user token acts on that user's own
 * units; the operator's admin token (env) on every unit, which is what a
 * single scheduled task summarising for the whole instance needs.
 */
export type ApiCaller = { kind: "user"; userId: string } | { kind: "admin" };

export function apiCaller(request: Request): ApiCaller | null {
  const token = bearer(request);
  if (!token) return null;
  if (config.adminToken && safeEqual(token, config.adminToken)) return { kind: "admin" };
  const row = db().prepare("SELECT id, user_id FROM api_tokens WHERE token_hash = ?").get(sha256Hex(token)) as
    { id: string; user_id: string } | undefined;
  if (!row) return null;
  db().prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return { kind: "user", userId: row.user_id };
}

export function isWorker(request: Request): boolean {
  const token = bearer(request);
  return !!token && !!config.workerToken && safeEqual(token, config.workerToken);
}

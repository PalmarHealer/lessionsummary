import type { Handle } from "@sveltejs/kit";
import { SESSION_COOKIE, userForSession } from "$lib/server/auth";

/** Paths that authenticate with a Bearer token (or not at all) instead of our cookie. */
function isMachinePath(path: string): boolean {
  return path.startsWith("/api/v1/") || path.startsWith("/api/worker/") || path === "/mcp";
}

function isPublic(path: string): boolean {
  return path === "/login" || path.startsWith("/auth/") || path === "/favicon.svg" || path.startsWith("/_app/")
    || isMachinePath(path);
}

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const method = event.request.method;

  // SvelteKit's own origin check is off (see svelte.config.js) because the
  // machine APIs are cross-origin by design. Everything that rides on the
  // session cookie gets the check back here — including raw uploads, which
  // aren't form-encoded and so would slip past SvelteKit's check anyway.
  if (!isMachinePath(path) && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = event.request.headers.get("origin");
    if (origin && new URL(origin).host !== event.url.host) {
      return new Response("Cross-site request forbidden", { status: 403 });
    }
  }

  event.locals.user = isMachinePath(path) ? null : userForSession(event.cookies.get(SESSION_COOKIE));

  if (!event.locals.user && !isPublic(path)) {
    if (path.startsWith("/api/")) {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }
    return new Response(null, {
      status: 303,
      headers: { location: `/login?next=${encodeURIComponent(path + event.url.search)}` },
    });
  }

  const response = await resolve(event);
  const h = response.headers;
  if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
  if (!h.has("referrer-policy")) h.set("referrer-policy", "strict-origin-when-cross-origin");
  if (!h.has("x-frame-options")) h.set("x-frame-options", "SAMEORIGIN");
  return response;
};

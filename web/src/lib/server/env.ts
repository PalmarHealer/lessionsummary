import { env } from "$env/dynamic/private";
import { resolve } from "node:path";

/**
 * Runtime configuration. Read lazily through getters so `vite build` doesn't
 * need the secrets — adapter-node only knows them once the container starts.
 */
export const config = {
  get dataDir() {
    return resolve(env.LS_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/app/data" : "./data"));
  },
  /** Public origin of this app, e.g. https://summary.example.com (no trailing slash). */
  get origin() {
    return (env.ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  },
  get opensaxUrl() {
    return (env.OPENSAX_URL ?? "").replace(/\/$/, "");
  },
  get clientId() {
    return env.OPENSAX_CLIENT_ID ?? "lessionsummary";
  },
  get clientSecret() {
    return env.OPENSAX_CLIENT_SECRET ?? "";
  },
  /** Shared secret of the transcription/extraction workers. */
  get workerToken() {
    return env.LS_WORKER_TOKEN ?? "";
  },
  /** Optional operator token for the summary API/MCP that sees every unit. */
  get adminToken() {
    return env.LS_ADMIN_TOKEN ?? "";
  },
  get maxUploadBytes() {
    return Number(env.LS_MAX_UPLOAD_MB ?? 2048) * 1024 * 1024;
  },
  /** Local-only shortcut that skips OpenSax. Never honoured in a production build. */
  get devLogin() {
    return process.env.NODE_ENV !== "production" && env.LS_DEV_LOGIN === "1";
  },
};

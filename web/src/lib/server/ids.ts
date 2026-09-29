import { createHash, randomBytes } from "node:crypto";

/** Short URL-safe id, e.g. for units and files. */
export function newId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

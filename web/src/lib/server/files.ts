import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { db } from "./db";
import { config } from "./env";
import { newId } from "./ids";
import { enqueueJob } from "./jobs";
import { bumpMaterial } from "./units";

export type FileKind = "audio" | "document" | "image" | "other";

export interface FileRow {
  id: string;
  unit_id: string;
  kind: FileKind;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  created_at: number;
  options: string;
  extracted_text: string | null;
  extract_meta: string | null;
}

export interface AudioOptions {
  language?: string | null;
  min_speakers?: number | null;
  max_speakers?: number | null;
}

/** Formats the extraction worker understands. Everything else is stored only. */
const DOCUMENT_EXT = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "ods", "txt", "md", "csv"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "flac", "aac", "wma", "mp4", "mov", "mkv"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg"]);

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  ppt: "application/vnd.ms-powerpoint",
  xls: "application/vnd.ms-excel",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain", md: "text/markdown", csv: "text/csv",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  webm: "audio/webm", flac: "audio/flac", aac: "audio/aac", wma: "audio/x-ms-wma",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", bmp: "image/bmp", svg: "image/svg+xml",
};

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * The extension decides, not the browser's MIME guess: Windows reports .m4a
 * as audio/x-m4a, some phones send everything as octet-stream.
 */
export function classify(name: string, mime: string): { kind: FileKind; mime: string } {
  const e = ext(name);
  const known = MIME_BY_EXT[e];
  const m = known ?? (mime || "application/octet-stream");
  if (AUDIO_EXT.has(e) || m.startsWith("audio/")) return { kind: "audio", mime: m };
  if (IMAGE_EXT.has(e) || m.startsWith("image/")) return { kind: "image", mime: m };
  if (DOCUMENT_EXT.has(e) || ["doc", "ppt", "xls"].includes(e)) return { kind: "document", mime: m };
  return { kind: "other", mime: m };
}

function unitDir(unitId: string): string {
  return join(config.dataDir, "files", unitId.replace(/[^a-zA-Z0-9_-]/g, ""));
}

export function filePath(f: Pick<FileRow, "unit_id" | "id">): string {
  return join(unitDir(f.unit_id), f.id.replace(/[^a-zA-Z0-9_-]/g, ""));
}

export class UploadTooLarge extends Error {}

/**
 * Stream an upload straight to disk, hashing on the way. A lesson recording
 * can be a gigabyte of WAV; buffering it would take the whole container down.
 */
export async function storeUpload(
  unitId: string,
  name: string,
  mimeHint: string,
  body: ReadableStream<Uint8Array>,
  audio: AudioOptions = {},
): Promise<FileRow> {
  const id = newId(12);
  const { kind, mime } = classify(name, mimeHint);
  mkdirSync(unitDir(unitId), { recursive: true });
  const dest = join(unitDir(unitId), id);

  const hash = createHash("sha256");
  let size = 0;
  const limit = config.maxUploadBytes;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > limit) return cb(new UploadTooLarge(`Datei größer als ${Math.round(limit / 1048576)} MB`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), meter, createWriteStream(dest));
  } catch (err) {
    rmSync(dest, { force: true });
    throw err;
  }

  const row: FileRow = {
    id, unit_id: unitId, kind, name, mime, size,
    sha256: hash.digest("hex"),
    created_at: Date.now(),
    options: JSON.stringify(kind === "audio" ? audio : {}),
    extracted_text: null,
    extract_meta: null,
  };
  const d = db();
  d.transaction(() => {
    d.prepare(`
      INSERT INTO files (id, unit_id, kind, name, mime, size, sha256, created_at, options)
      VALUES (@id, @unit_id, @kind, @name, @mime, @size, @sha256, @created_at, @options)
    `).run(row);
    if (kind === "audio") enqueueJob(id, "transcribe");
    else if (kind === "document") enqueueJob(id, "extract");
    // Images count as material the moment they land; audio and documents
    // only once their text exists (the job completion bumps then).
    else bumpMaterial(unitId);
  })();
  return row;
}

export function getFile(id: string): FileRow | null {
  return (db().prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined) ?? null;
}

export function listFiles(unitId: string): FileRow[] {
  return db().prepare("SELECT * FROM files WHERE unit_id = ? ORDER BY created_at").all(unitId) as FileRow[];
}

export function deleteFile(f: FileRow): void {
  db().prepare("DELETE FROM files WHERE id = ?").run(f.id);
  rmSync(filePath(f), { force: true });
  bumpMaterial(f.unit_id);
}

export function deleteUnitFiles(unitId: string): void {
  rmSync(unitDir(unitId), { recursive: true, force: true });
}

/**
 * Serve a stored file with Range support — the audio player needs it to seek,
 * which is how clicking a transcript line jumps to that moment.
 */
export function fileResponse(f: FileRow, request: Request, opts: { download?: boolean } = {}): Response {
  const path = filePath(f);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("Datei fehlt auf dem Server", { status: 404 });
  }
  const headers = new Headers({
    "content-type": f.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "content-disposition": `${opts.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "x-content-type-options": "nosniff",
  });
  // Uploaded HTML/SVG must never run in our origin. PDFs are exempt: browsers
  // refuse to render them inside a sandboxed document at all.
  if (f.mime !== "application/pdf") {
    headers.set("content-security-policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }
  headers.set("content-length", String(size));
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers });
}

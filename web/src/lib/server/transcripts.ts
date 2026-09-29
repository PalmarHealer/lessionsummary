import { db } from "./db";
import { bumpMaterial } from "./units";

export interface Segment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface Transcript {
  file_id: string;
  language: string | null;
  duration: number | null;
  model: string | null;
  diarized: boolean;
  segments: Segment[];
  /** Diarization label → name someone gave it, e.g. SPEAKER_00 → "Lehrkraft". */
  speakers: Record<string, string>;
}

interface Row {
  file_id: string;
  language: string | null;
  duration: number | null;
  model: string | null;
  diarized: number;
  segments: string;
  speakers: string;
}

function parse(r: Row): Transcript {
  return { ...r, diarized: r.diarized === 1, segments: JSON.parse(r.segments), speakers: JSON.parse(r.speakers) };
}

export function getTranscript(fileId: string): Transcript | null {
  const r = db().prepare("SELECT * FROM transcripts WHERE file_id = ?").get(fileId) as Row | undefined;
  return r ? parse(r) : null;
}

export function transcriptsForUnit(unitId: string): Map<string, Transcript> {
  const rows = db().prepare(`
    SELECT t.* FROM transcripts t JOIN files f ON f.id = t.file_id WHERE f.unit_id = ?
  `).all(unitId) as Row[];
  return new Map(rows.map((r) => [r.file_id, parse(r)]));
}

/** Names change what the summary may attribute to whom, so they count as material. */
export function renameSpeakers(fileId: string, unitId: string, names: Record<string, string>): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(names)) if (v.trim()) clean[k] = v.trim().slice(0, 60);
  db().prepare("UPDATE transcripts SET speakers = ? WHERE file_id = ?").run(JSON.stringify(clean), fileId);
  bumpMaterial(unitId);
}

export function speakerName(t: Transcript, label: string | null): string {
  if (!label) return "Unbekannt";
  if (t.speakers[label]) return t.speakers[label]!;
  const n = /(\d+)$/.exec(label);
  return n ? `Sprecher ${Number(n[1]) + 1}` : label;
}

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Plain-text transcript, one speaker turn per line — the form an LLM reads best. */
export function transcriptText(t: Transcript): string {
  return t.segments
    .map((s) => `[${fmtTime(s.start)}] ${t.diarized ? `${speakerName(t, s.speaker)}: ` : ""}${s.text}`)
    .join("\n");
}

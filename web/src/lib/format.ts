export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export const SHARE_LABELS = {
  private: "Privat",
  school: "Meine Schule",
  lernsax: "Alle LernSax-Nutzer",
} as const;

/** Speaker label → display name, with a stable colour per label. */
export function speakerLabel(names: Record<string, string>, label: string | null): string {
  if (!label) return "Unbekannt";
  if (names[label]) return names[label]!;
  const n = /(\d+)$/.exec(label);
  return n ? `Sprecher ${Number(n[1]) + 1}` : label;
}

const SPEAKER_HUES = [160, 210, 30, 280, 340, 90, 190, 50];
export function speakerHue(label: string | null): number {
  const n = label ? Number(/(\d+)$/.exec(label)?.[1] ?? 0) : 0;
  return SPEAKER_HUES[n % SPEAKER_HUES.length]!;
}

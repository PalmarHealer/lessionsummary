export interface UnitForm {
  title: string;
  subject: string;
  held_on: string | null;
  notes: string;
}

export function readUnitForm(data: FormData): UnitForm {
  const date = String(data.get("held_on") ?? "").trim();
  return {
    title: String(data.get("title") ?? "").trim().slice(0, 200),
    subject: String(data.get("subject") ?? "").trim().slice(0, 80),
    held_on: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    notes: String(data.get("notes") ?? "").slice(0, 20_000),
  };
}

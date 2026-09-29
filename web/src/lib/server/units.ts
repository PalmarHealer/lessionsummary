import { db } from "./db";
import { newId } from "./ids";
import type { User } from "./auth";

export type ShareScope = "private" | "school" | "lernsax";

export interface Unit {
  id: string;
  owner_id: string;
  title: string;
  subject: string;
  held_on: string | null;
  notes: string;
  created_at: number;
  updated_at: number;
  material_rev: number;
  summary_md: string | null;
  summary_rev: number;
  summary_at: number | null;
  summary_by: "api" | "manual" | null;
  share_scope: ShareScope;
  share_school: string | null;
  share_materials: number;
}

export interface UnitListItem {
  id: string;
  title: string;
  subject: string;
  held_on: string | null;
  updated_at: number;
  has_summary: number;
  summary_due: number;
  share_scope: ShareScope;
  file_count: number;
  processing: number;
  owner_name?: string;
  excerpt?: string | null;
}

// ── Access ──────────────────────────────────────────────────────────────

export interface Access {
  /** Summary + metadata. */
  view: boolean;
  /** Files, transcripts, extracted text. */
  materials: boolean;
  edit: boolean;
}

export function accessFor(unit: Unit, user: User | null): Access {
  if (!user) return { view: false, materials: false, edit: false };
  if (unit.owner_id === user.id) return { view: true, materials: true, edit: true };
  // Every user we know signed in through OpenSax, i.e. holds a LernSax
  // account — that is exactly the audience of a "lernsax" share.
  const view = unit.share_scope === "lernsax"
    || (unit.share_scope === "school" && !!unit.share_school && user.schools.some((s) => s.id === unit.share_school));
  return { view, materials: view && unit.share_materials === 1, edit: false };
}

// ── Queries ─────────────────────────────────────────────────────────────

export function getUnit(id: string): Unit | null {
  return (db().prepare("SELECT * FROM units WHERE id = ?").get(id) as Unit | undefined) ?? null;
}

const LIST_COLUMNS = `
  u.id, u.title, u.subject, u.held_on, u.updated_at, u.share_scope,
  u.summary_md IS NOT NULL AS has_summary,
  u.summary_rev < u.material_rev AS summary_due,
  (SELECT COUNT(*) FROM files f WHERE f.unit_id = u.id) AS file_count,
  (SELECT COUNT(*) FROM jobs j JOIN files f ON f.id = j.file_id
     WHERE f.unit_id = u.id AND j.status IN ('queued', 'running')) AS processing`;

export function listOwnUnits(userId: string, q = ""): UnitListItem[] {
  const like = `%${q.trim()}%`;
  return db().prepare(`
    SELECT ${LIST_COLUMNS}, substr(u.summary_md, 1, 400) AS excerpt
    FROM units u
    WHERE u.owner_id = ? AND (? = '%%' OR u.title LIKE ? OR u.subject LIKE ?)
    ORDER BY COALESCE(u.held_on, date(u.created_at / 1000, 'unixepoch')) DESC, u.created_at DESC
  `).all(userId, like, like, like) as UnitListItem[];
}

/** Summaries other people shared with this user. Only units that have one. */
export function listSharedWith(user: User, q = ""): UnitListItem[] {
  const like = `%${q.trim()}%`;
  const schools = user.schools.map((s) => s.id);
  const placeholders = schools.map(() => "?").join(",") || "NULL";
  return db().prepare(`
    SELECT ${LIST_COLUMNS}, o.name AS owner_name, substr(u.summary_md, 1, 400) AS excerpt
    FROM units u JOIN users o ON o.id = u.owner_id
    WHERE u.owner_id != ?
      AND u.summary_md IS NOT NULL
      AND (u.share_scope = 'lernsax' OR (u.share_scope = 'school' AND u.share_school IN (${placeholders})))
      AND (? = '%%' OR u.title LIKE ? OR u.subject LIKE ?)
    ORDER BY COALESCE(u.held_on, date(u.created_at / 1000, 'unixepoch')) DESC
    LIMIT 200
  `).all(user.id, ...schools, like, like, like) as UnitListItem[];
}

export function subjectsOf(userId: string): string[] {
  return (db().prepare("SELECT DISTINCT subject FROM units WHERE owner_id = ? AND subject != '' ORDER BY subject")
    .all(userId) as Array<{ subject: string }>).map((r) => r.subject);
}

// ── Mutations ───────────────────────────────────────────────────────────

export function createUnit(ownerId: string, input: { title: string; subject: string; held_on: string | null; notes: string }): string {
  const id = newId(9);
  const now = Date.now();
  db().prepare(`
    INSERT INTO units (id, owner_id, title, subject, held_on, notes, created_at, updated_at, material_rev)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, input.title, input.subject, input.held_on, input.notes, now, now, input.notes.trim() ? 1 : 0);
  return id;
}

export function updateUnitMeta(id: string, input: { title: string; subject: string; held_on: string | null; notes: string }): void {
  const before = getUnit(id);
  if (!before) return;
  // Notes feed the summary; title and date only label it.
  const bump = before.notes !== input.notes ? 1 : 0;
  db().prepare(`
    UPDATE units SET title = ?, subject = ?, held_on = ?, notes = ?, updated_at = ?, material_rev = material_rev + ?
    WHERE id = ?
  `).run(input.title, input.subject, input.held_on, input.notes, Date.now(), bump, id);
}

/** Something the summary is built from changed. */
export function bumpMaterial(unitId: string): void {
  db().prepare("UPDATE units SET material_rev = material_rev + 1, updated_at = ? WHERE id = ?").run(Date.now(), unitId);
}

/**
 * Store a summary. A manual edit is taken as covering the current material;
 * one from the API only covers the revision it was built from, so material
 * that arrived meanwhile keeps the unit due.
 */
export function saveSummary(unitId: string, markdown: string, by: "api" | "manual", basedOnRev?: number): void {
  const unit = getUnit(unitId);
  if (!unit) return;
  const rev = by === "manual" ? unit.material_rev : Math.min(basedOnRev ?? unit.material_rev, unit.material_rev);
  db().prepare(`
    UPDATE units SET summary_md = ?, summary_rev = ?, summary_at = ?, summary_by = ?, updated_at = ? WHERE id = ?
  `).run(markdown.trim() || null, rev, Date.now(), by, Date.now(), unitId);
}

export function setSharing(unitId: string, scope: ShareScope, school: string | null, materials: boolean): void {
  db().prepare("UPDATE units SET share_scope = ?, share_school = ?, share_materials = ?, updated_at = ? WHERE id = ?")
    .run(scope, scope === "school" ? school : null, scope === "private" ? 0 : materials ? 1 : 0, Date.now(), unitId);
}

export function deleteUnitRow(unitId: string): void {
  db().prepare("DELETE FROM units WHERE id = ?").run(unitId);
}

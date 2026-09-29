import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { deleteFile, deleteUnitFiles, getFile, listFiles } from "$lib/server/files";
import { readUnitForm } from "$lib/server/forms";
import { jobsForUnit, retryFile } from "$lib/server/jobs";
import { renameSpeakers, transcriptsForUnit } from "$lib/server/transcripts";
import {
  accessFor, deleteUnitRow, getUnit, saveSummary, setSharing, subjectsOf, updateUnitMeta, type ShareScope, type Unit,
} from "$lib/server/units";
import { renderMarkdown } from "$lib/markdown";
import { db } from "$lib/server/db";

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = locals.user!;
  const unit = getUnit(params.id);
  const access = unit ? accessFor(unit, user) : null;
  // Same answer for "doesn't exist" and "not shared with you".
  if (!unit || !access?.view) throw error(404, "Einheit nicht gefunden");

  const owner = db().prepare("SELECT name FROM users WHERE id = ?").get(unit.owner_id) as { name: string } | undefined;
  const jobs = access.materials ? jobsForUnit(unit.id) : new Map();
  const transcripts = access.materials ? transcriptsForUnit(unit.id) : new Map();
  const files = access.materials
    ? listFiles(unit.id).map((f) => {
        const job = jobs.get(f.id);
        return {
          id: f.id,
          kind: f.kind,
          name: f.name,
          mime: f.mime,
          size: f.size,
          created_at: f.created_at,
          has_text: !!f.extracted_text,
          job: job ? { status: job.status, error: job.error, kind: job.kind } : null,
          transcript: transcripts.get(f.id) ?? null,
        };
      })
    : [];

  return {
    unit: {
      id: unit.id,
      title: unit.title,
      subject: unit.subject,
      held_on: unit.held_on,
      notes: access.materials ? unit.notes : "",
      summary_md: unit.summary_md,
      summary_html: renderMarkdown(unit.summary_md),
      summary_at: unit.summary_at,
      summary_by: unit.summary_by,
      summary_due: unit.summary_rev < unit.material_rev,
      share_scope: unit.share_scope,
      share_school: unit.share_school,
      share_materials: unit.share_materials === 1,
      owner_name: owner?.name ?? "",
    },
    access,
    files,
    processing: files.some((f) => f.job && (f.job.status === "queued" || f.job.status === "running")),
    subjects: access.edit ? subjectsOf(user.id) : [],
    schools: user.schools,
  };
};

/** Load the unit for a mutating action; only the owner gets past this. */
function own(params: { id: string }, locals: App.Locals): Unit {
  const unit = getUnit(params.id);
  if (!unit || !accessFor(unit, locals.user).edit) throw error(404, "Einheit nicht gefunden");
  return unit;
}

function fileOf(unit: Unit, data: FormData) {
  const f = getFile(String(data.get("file_id") ?? ""));
  if (!f || f.unit_id !== unit.id) throw error(404, "Datei nicht gefunden");
  return f;
}

export const actions: Actions = {
  meta: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    const input = readUnitForm(await request.formData());
    if (!input.title) return fail(400, { error: "Titel fehlt" });
    updateUnitMeta(unit.id, input);
    return { saved: "meta" };
  },

  summary: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    const md = String((await request.formData()).get("summary") ?? "");
    saveSummary(unit.id, md, "manual");
    return { saved: "summary" };
  },

  share: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    const data = await request.formData();
    const scope = String(data.get("scope") ?? "private") as ShareScope;
    if (!["private", "school", "lernsax"].includes(scope)) return fail(400, { error: "Ungültige Freigabe" });
    let school: string | null = null;
    if (scope === "school") {
      // Only a school the owner actually belongs to — otherwise anyone could
      // publish into a school they have nothing to do with.
      school = String(data.get("school") ?? "") || locals.user!.schools[0]?.id || null;
      if (!locals.user!.schools.length) return fail(400, { error: "Dein Konto ist keiner Schule zugeordnet." });
      if (!school || !locals.user!.schools.some((s) => s.id === school)) {
        return fail(400, { error: "Diese Schule gehört nicht zu deinem Konto." });
      }
    }
    setSharing(unit.id, scope, school, data.get("materials") === "on");
    return { saved: "share" };
  },

  deleteFile: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    deleteFile(fileOf(unit, await request.formData()));
    return { saved: "file" };
  },

  retry: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    const f = fileOf(unit, await request.formData());
    if (f.kind === "audio") retryFile(f.id, "transcribe");
    else if (f.kind === "document") retryFile(f.id, "extract");
    return { saved: "retry" };
  },

  speakers: async ({ params, locals, request }) => {
    const unit = own(params, locals);
    const data = await request.formData();
    const f = fileOf(unit, data);
    const names: Record<string, string> = {};
    for (const [k, v] of data) {
      if (k.startsWith("speaker:")) names[k.slice(8)] = String(v);
    }
    renameSpeakers(f.id, unit.id, names);
    return { saved: "speakers" };
  },

  delete: async ({ params, locals }) => {
    const unit = own(params, locals);
    deleteUnitRow(unit.id);
    deleteUnitFiles(unit.id);
    throw redirect(303, "/");
  },
};

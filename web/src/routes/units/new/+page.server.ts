import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createUnit, subjectsOf } from "$lib/server/units";
import { readUnitForm } from "$lib/server/forms";

export const load: PageServerLoad = async ({ locals }) => {
  return { subjects: subjectsOf(locals.user!.id) };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const input = readUnitForm(await request.formData());
    if (!input.title) return fail(400, { error: "Titel fehlt", ...input });
    const id = createUnit(locals.user!.id, input);
    throw redirect(303, `/units/${id}`);
  },
};

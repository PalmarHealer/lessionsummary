<script lang="ts">
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  import UnitFields from "$lib/components/UnitFields.svelte";

  let { data, form } = $props();
  let busy = $state(false);
</script>

<svelte:head><title>Neue Einheit · LessionSummary</title></svelte:head>

<div class="mx-auto max-w-2xl">
  <a href="/" class="btn-ghost mb-4 -ml-2"><Icon name="chevron-left" size={16} />Zurück</a>
  <h1 class="mb-1 text-2xl font-bold">Neue Einheit</h1>
  <p class="mb-6 text-sm text-muted">Dateien und Aufnahmen fügst du im nächsten Schritt hinzu.</p>

  <form
    method="POST"
    class="card space-y-4 p-5"
    use:enhance={() => {
      busy = true;
      return async ({ update }) => {
        await update();
        busy = false;
      };
    }}
  >
    {#if form?.error}<p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{form.error}</p>{/if}
    <UnitFields subjects={data.subjects} title={form?.title} subject={form?.subject} held_on={form?.held_on} notes={form?.notes} />
    <div class="flex justify-end">
      <button class="btn-primary" disabled={busy}>Anlegen<Icon name="chevron-right" size={16} /></button>
    </div>
  </form>
</div>

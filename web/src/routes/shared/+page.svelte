<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import UnitCard from "$lib/components/UnitCard.svelte";

  let { data } = $props();

  // Group by subject: someone looking for last week's physics lesson scans
  // by subject first, not by date.
  const groups = $derived.by(() => {
    const m = new Map<string, typeof data.units>();
    for (const u of data.units) {
      const k = u.subject || "Ohne Fach";
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "de"));
  });
</script>

<svelte:head><title>Geteilt · LessionSummary</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
  <div class="mr-auto">
    <h1 class="text-2xl font-bold">Geteilte Zusammenfassungen</h1>
    <p class="text-sm text-muted">
      Von anderen freigegeben – für {data.schools.length ? data.schools.map((s) => s.name).join(", ") : "alle LernSax-Nutzer"}{data.schools.length ? " oder für alle" : ""}.
    </p>
  </div>
  <form method="GET" class="relative w-full sm:w-64">
    <Icon name="search" size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
    <input class="input pl-9" type="search" name="q" value={data.q} placeholder="Titel oder Fach …" />
  </form>
</div>

{#if groups.length}
  <div class="space-y-8">
    {#each groups as [subject, units] (subject)}
      <section>
        <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{subject}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each units as unit (unit.id)}
            <UnitCard {unit} showOwner />
          {/each}
        </div>
      </section>
    {/each}
  </div>
{:else}
  <p class="py-16 text-center text-muted">
    {data.q ? `Nichts gefunden für „${data.q}".` : "Noch hat niemand etwas mit dir geteilt."}
  </p>
{/if}

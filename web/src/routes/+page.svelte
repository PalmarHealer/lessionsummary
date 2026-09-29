<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import UnitCard from "$lib/components/UnitCard.svelte";

  let { data } = $props();
</script>

<svelte:head><title>Meine Einheiten · LessionSummary</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
  <h1 class="mr-auto text-2xl font-bold">Meine Einheiten</h1>
  <form method="GET" class="relative w-full sm:w-64">
    <Icon name="search" size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
    <input class="input pl-9" type="search" name="q" value={data.q} placeholder="Suchen …" />
  </form>
  <a href="/units/new" class="btn-primary"><Icon name="plus" size={16} />Neue Einheit</a>
</div>

{#if data.units.length}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each data.units as unit (unit.id)}
      <UnitCard {unit} />
    {/each}
  </div>
{:else if data.q}
  <p class="py-16 text-center text-muted">Keine Einheit passt zu „{data.q}".</p>
{:else}
  <div class="card mx-auto max-w-md p-8 text-center">
    <div class="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
      <Icon name="sparkles" size={24} />
    </div>
    <h2 class="font-semibold">Noch keine Einheiten</h2>
    <p class="mt-1 text-sm text-muted">
      Lege eine Einheit an und lade Aufnahme, Folien, Arbeitsblätter oder Fotos vom Tafelbild hoch. Die Zusammenfassung entsteht daraus automatisch.
    </p>
    <a href="/units/new" class="btn-primary mt-5"><Icon name="plus" size={16} />Erste Einheit anlegen</a>
  </div>
{/if}

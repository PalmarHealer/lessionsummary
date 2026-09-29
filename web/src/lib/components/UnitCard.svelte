<script lang="ts">
  import Icon from "./Icon.svelte";
  import { fmtDate, SHARE_LABELS } from "$lib/format";

  interface Props {
    unit: {
      id: string;
      title: string;
      subject: string;
      held_on: string | null;
      has_summary: number;
      summary_due: number;
      share_scope: keyof typeof SHARE_LABELS;
      file_count: number;
      processing: number;
      owner_name?: string;
      excerpt?: string | null;
    };
    showOwner?: boolean;
  }
  let { unit, showOwner = false }: Props = $props();

  /** First lines of the summary without Markdown syntax, as a teaser. */
  const teaser = $derived(
    (unit.excerpt ?? "")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_`>|-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180),
  );
</script>

<a href="/units/{unit.id}" class="card group flex flex-col gap-2 p-4 transition-colors hover:border-accent/60">
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      {#if unit.subject}
        <p class="text-xs font-semibold uppercase tracking-wide text-accent">{unit.subject}</p>
      {/if}
      <h3 class="truncate font-semibold group-hover:text-accent">{unit.title}</h3>
    </div>
    {#if !showOwner && unit.share_scope !== "private"}
      <span class="shrink-0 text-muted" title="Geteilt: {SHARE_LABELS[unit.share_scope]}">
        <Icon name={unit.share_scope === "school" ? "school" : "world"} size={16} />
      </span>
    {/if}
  </div>

  {#if teaser}
    <p class="line-clamp-3 text-sm text-muted">{teaser}</p>
  {:else}
    <p class="text-sm italic text-muted">Noch keine Zusammenfassung</p>
  {/if}

  <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted">
    {#if unit.held_on}<span>{fmtDate(unit.held_on)}</span>{/if}
    {#if showOwner && unit.owner_name}<span>von {unit.owner_name}</span>{/if}
    {#if !showOwner}
      <span class="flex items-center gap-1"><Icon name="paperclip" size={12} />{unit.file_count}</span>
    {/if}
    {#if unit.processing > 0}
      <span class="flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-info">
        <Icon name="loader" size={12} class="animate-spin" />Verarbeitung
      </span>
    {:else if !showOwner && unit.summary_due}
      <span class="rounded-full bg-warn-soft px-2 py-0.5 text-warn">Zusammenfassung ausstehend</span>
    {/if}
  </div>
</a>

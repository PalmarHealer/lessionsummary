<script lang="ts">
  import { enhance } from "$app/forms";
  import Icon from "./Icon.svelte";
  import { fmtTime, speakerHue, speakerLabel } from "$lib/format";

  interface Props {
    fileId: string;
    transcript: {
      language: string | null;
      duration: number | null;
      diarized: boolean;
      segments: Array<{ start: number; end: number; speaker: string | null; text: string }>;
      speakers: Record<string, string>;
    };
    editable: boolean;
  }
  let { fileId, transcript, editable }: Props = $props();

  let audio: HTMLAudioElement;
  let now = $state(0);
  let query = $state("");
  let naming = $state(false);

  const labels = $derived([...new Set(transcript.segments.map((s) => s.speaker).filter(Boolean))] as string[]);
  const current = $derived(transcript.segments.findIndex((s) => now >= s.start && now < s.end));
  const visible = $derived(
    query.trim()
      ? transcript.segments.map((s, i) => ({ s, i })).filter(({ s }) => s.text.toLowerCase().includes(query.toLowerCase()))
      : transcript.segments.map((s, i) => ({ s, i })),
  );

  function seek(t: number) {
    audio.currentTime = t;
    audio.play().catch(() => {});
  }
</script>

<div class="space-y-3">
  <audio bind:this={audio} src="/files/{fileId}" controls preload="metadata" class="w-full" ontimeupdate={() => (now = audio.currentTime)}></audio>

  <div class="flex flex-wrap items-center gap-2">
    <div class="relative min-w-40 flex-1">
      <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input class="input py-1.5 pl-8" type="search" placeholder="Im Transkript suchen" bind:value={query} />
    </div>
    {#if transcript.diarized && editable}
      <button type="button" class="btn py-1.5" onclick={() => (naming = !naming)}>
        <Icon name="users" size={14} />Sprecher benennen
      </button>
    {/if}
  </div>

  {#if naming}
    <form
      method="POST"
      action="?/speakers"
      class="grid gap-2 rounded-lg border border-border bg-bg p-3 sm:grid-cols-2"
      use:enhance={() => async ({ update }) => {
        await update({ reset: false });
        naming = false;
      }}
    >
      <input type="hidden" name="file_id" value={fileId} />
      {#each labels as l}
        <label class="flex items-center gap-2 text-sm">
          <span class="h-3 w-3 shrink-0 rounded-full" style="background: hsl({speakerHue(l)} 65% 50%)"></span>
          <span class="w-24 shrink-0 text-muted">{speakerLabel({}, l)}</span>
          <input class="input py-1" name="speaker:{l}" value={transcript.speakers[l] ?? ""} placeholder="z. B. Lehrkraft" maxlength="60" />
        </label>
      {/each}
      <div class="flex justify-end gap-2 sm:col-span-2">
        <button type="button" class="btn-ghost" onclick={() => (naming = false)}>Abbrechen</button>
        <button class="btn-primary py-1.5">Speichern</button>
      </div>
    </form>
  {/if}

  <ol class="max-h-[32rem] space-y-1 overflow-y-auto pr-1">
    {#each visible as { s, i } (i)}
      <li>
        <button
          type="button"
          class="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 {i === current ? 'bg-accent-soft' : ''}"
          onclick={() => seek(s.start)}
        >
          <span class="w-14 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted">{fmtTime(s.start)}</span>
          <span class="min-w-0">
            {#if transcript.diarized}
              <span class="mr-1 font-semibold" style="color: hsl({speakerHue(s.speaker)} 60% 55%)">{speakerLabel(transcript.speakers, s.speaker)}:</span>
            {/if}
            {s.text}
          </span>
        </button>
      </li>
    {:else}
      <li class="px-2 py-4 text-center text-sm text-muted">Keine Treffer.</li>
    {/each}
  </ol>
  {#if !transcript.diarized}
    <p class="text-xs text-muted">Ohne Sprechererkennung transkribiert.</p>
  {/if}
</div>

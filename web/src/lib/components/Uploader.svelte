<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import Icon from "./Icon.svelte";
  import { fmtSize } from "$lib/format";
  import { uploadFile, type AudioHints } from "$lib/upload";

  interface Props {
    unitId: string;
    hints: AudioHints;
  }
  let { unitId, hints }: Props = $props();

  interface Item {
    key: number;
    name: string;
    size: number;
    progress: number;
    error: string | null;
    done: boolean;
  }
  let items = $state<Item[]>([]);
  let dragging = $state(false);
  let input: HTMLInputElement;
  let seq = 0;

  async function add(files: FileList | File[]) {
    // One after another: parallel uploads of several recordings would only
    // compete for the same upstream bandwidth.
    const batch = [...files].map((f) => ({ file: f, item: { key: ++seq, name: f.name, size: f.size, progress: 0, error: null, done: false } }));
    items = [...items, ...batch.map((b) => b.item)];
    for (const { file, item } of batch) {
      const idx = () => items.findIndex((i) => i.key === item.key);
      try {
        await uploadFile(unitId, file, file.name, hints, (p) => (items[idx()]!.progress = p));
        items[idx()]!.done = true;
      } catch (err) {
        items[idx()]!.error = (err as Error).message;
      }
    }
    await invalidateAll();
    items = items.filter((i) => i.error);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) add(e.dataTransfer.files);
  }
</script>

<div
  role="region"
  aria-label="Dateien hochladen"
  class="rounded-xl border-2 border-dashed p-5 text-center transition-colors {dragging ? 'border-accent bg-accent-soft' : 'border-border'}"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <Icon name="upload" size={22} class="mx-auto mb-2 text-muted" />
  <p class="text-sm">
    Dateien hierher ziehen oder
    <button type="button" class="font-medium text-accent hover:underline" onclick={() => input.click()}>auswählen</button>
  </p>
  <p class="mt-1 text-xs text-muted">Audio &amp; Video · PDF, Word, PowerPoint, Excel, OpenDocument · Bilder</p>
  <input
    bind:this={input}
    type="file"
    multiple
    class="hidden"
    onchange={(e) => {
      const t = e.currentTarget;
      if (t.files?.length) add(t.files);
      t.value = "";
    }}
  />
</div>

{#if items.length}
  <ul class="mt-3 space-y-2">
    {#each items as item (item.key)}
      <li class="rounded-lg border border-border bg-bg px-3 py-2 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate">{item.name}</span>
          <span class="shrink-0 text-xs text-muted">{fmtSize(item.size)}</span>
        </div>
        {#if item.error}
          <p class="mt-1 text-xs text-danger">{item.error}</p>
        {:else}
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div class="h-full bg-accent transition-[width]" style="width: {Math.round(item.progress * 100)}%"></div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

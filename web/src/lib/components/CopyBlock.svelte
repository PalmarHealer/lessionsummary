<script lang="ts">
  import Icon from "./Icon.svelte";

  let { text, label = "" }: { text: string; label?: string } = $props();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="relative">
  {#if label}<p class="label">{label}</p>{/if}
  <pre class="max-h-72 overflow-auto rounded-lg border border-border bg-bg p-3 pr-12 text-xs leading-relaxed whitespace-pre-wrap break-all"><code>{text}</code></pre>
  <button type="button" class="btn-ghost absolute right-1.5 {label ? 'top-7' : 'top-1.5'}" onclick={copy} aria-label="Kopieren" title="Kopieren">
    <Icon name={copied ? "check" : "copy"} size={14} />
  </button>
</div>

<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import Recorder from "$lib/components/Recorder.svelte";
  import TranscriptView from "$lib/components/TranscriptView.svelte";
  import Uploader from "$lib/components/Uploader.svelte";
  import UnitFields from "$lib/components/UnitFields.svelte";
  import { fmtDate, fmtDateTime, fmtSize, fmtTime, SHARE_LABELS } from "$lib/format";
  import { renderMarkdown } from "$lib/markdown";

  let { data, form } = $props();
  const unit = $derived(data.unit);
  const edit = $derived(data.access.edit);

  let editingMeta = $state(false);
  let editingSummary = $state(false);
  let draft = $state("");
  let preview = $state(false);
  let showShare = $state(false);
  let tab = $state<"audio" | "document" | "image">("audio");

  // Hints for the transcription of the next recordings/uploads.
  let hints = $state({ language: "de", min_speakers: null as number | null, max_speakers: null as number | null });

  const audio = $derived(data.files.filter((f) => f.kind === "audio"));
  const docs = $derived(data.files.filter((f) => f.kind === "document" || f.kind === "other"));
  const images = $derived(data.files.filter((f) => f.kind === "image"));
  const tabs = $derived([
    { id: "audio" as const, label: "Aufnahmen", icon: "microphone", count: audio.length },
    { id: "document" as const, label: "Dokumente", icon: "file", count: docs.length },
    { id: "image" as const, label: "Bilder", icon: "photo", count: images.length },
  ]);

  // Pick the first tab that has something in it, once.
  let tabChosen = false;
  $effect(() => {
    if (tabChosen || !data.files.length) return;
    tabChosen = true;
    tab = audio.length ? "audio" : docs.length ? "document" : "image";
  });

  // While the worker is busy, keep the page fresh so transcripts and the
  // status badges appear without a reload.
  $effect(() => {
    if (!data.processing) return;
    const t = setInterval(() => invalidateAll(), 8000);
    return () => clearInterval(t);
  });

  function startEditSummary() {
    draft = unit.summary_md ?? "";
    preview = false;
    editingSummary = true;
  }

  function jobBadge(job: { status: string; kind: string; error: string | null } | null) {
    if (!job || job.status === "done") return null;
    if (job.status === "failed") return { cls: "bg-danger-soft text-danger", text: "Fehlgeschlagen", title: job.error ?? "" };
    const what = job.kind === "transcribe" ? "Transkription" : "Texterkennung";
    return job.status === "running"
      ? { cls: "bg-info-soft text-info", text: `${what} läuft`, title: "" }
      : { cls: "bg-surface-2 text-muted", text: `${what} wartet`, title: "Wird verarbeitet, sobald ein Worker läuft" };
  }

  const shareIcon = $derived(unit.share_scope === "school" ? "school" : unit.share_scope === "lernsax" ? "world" : "lock");
</script>

<svelte:head><title>{unit.title} · LessionSummary</title></svelte:head>

<a href={edit ? "/" : "/shared"} class="btn-ghost mb-3 -ml-2"><Icon name="chevron-left" size={16} />{edit ? "Meine Einheiten" : "Geteilt"}</a>

<!-- Header -->
{#if editingMeta}
  <form
    method="POST"
    action="?/meta"
    class="card mb-6 space-y-4 p-5"
    use:enhance={() => async ({ update, result }) => {
      await update({ reset: false });
      if (result.type === "success") editingMeta = false;
    }}
  >
    <UnitFields title={unit.title} subject={unit.subject} held_on={unit.held_on} notes={unit.notes} subjects={data.subjects} />
    <div class="flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (editingMeta = false)}>Abbrechen</button>
      <button class="btn-primary">Speichern</button>
    </div>
  </form>
{:else}
  <div class="mb-6 flex flex-wrap items-start gap-3">
    <div class="min-w-0 flex-1">
      {#if unit.subject}<p class="text-sm font-semibold uppercase tracking-wide text-accent">{unit.subject}</p>{/if}
      <h1 class="text-2xl font-bold sm:text-3xl">{unit.title}</h1>
      <p class="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted">
        {#if unit.held_on}<span>{fmtDate(unit.held_on)}</span>{/if}
        {#if !edit}<span>von {unit.owner_name}</span>{/if}
        {#if edit}
          <span class="flex items-center gap-1"><Icon name={shareIcon} size={14} />{SHARE_LABELS[unit.share_scope]}</span>
        {/if}
      </p>
    </div>
    {#if edit}
      <div class="flex gap-2">
        <button class="btn" onclick={() => (showShare = !showShare)}><Icon name="share" size={16} />Teilen</button>
        <button class="btn" onclick={() => (editingMeta = true)} aria-label="Bearbeiten"><Icon name="pencil" size={16} /></button>
        <form
          method="POST"
          action="?/delete"
          use:enhance={({ cancel }) => {
            if (!confirm("Einheit mit allen Dateien, Transkripten und der Zusammenfassung löschen?")) cancel();
          }}
        >
          <button class="btn-danger" aria-label="Einheit löschen"><Icon name="trash" size={16} /></button>
        </form>
      </div>
    {/if}
  </div>
{/if}

<!-- Sharing -->
{#if showShare && edit}
  <form
    method="POST"
    action="?/share"
    class="card mb-6 space-y-4 p-5"
    use:enhance={() => async ({ update, result }) => {
      await update({ reset: false });
      if (result.type === "success") showShare = false;
    }}
  >
    <h2 class="font-semibold">Zusammenfassung teilen</h2>
    {#if form?.error}<p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{form.error}</p>{/if}
    <div class="grid gap-2 sm:grid-cols-3">
      {#each [
        { v: "private", icon: "lock", t: "Privat", d: "Nur du" },
        { v: "school", icon: "school", t: "Meine Schule", d: "Alle an deiner Schule", disabled: !data.schools.length },
        { v: "lernsax", icon: "world", t: "Alle", d: "Jede Person mit LernSax-Konto" },
      ] as opt}
        <label class="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft {opt.disabled ? 'opacity-50' : ''}">
          <input type="radio" name="scope" value={opt.v} checked={unit.share_scope === opt.v} disabled={opt.disabled} class="mt-1 accent-[var(--accent)]" />
          <span>
            <span class="flex items-center gap-1.5 text-sm font-medium"><Icon name={opt.icon} size={14} />{opt.t}</span>
            <span class="text-xs text-muted">{opt.d}</span>
          </span>
        </label>
      {/each}
    </div>
    {#if data.schools.length > 1}
      <label class="block">
        <span class="label">Schule</span>
        <select class="input" name="school">
          {#each data.schools as s}<option value={s.id} selected={s.id === unit.share_school}>{s.name}</option>{/each}
        </select>
      </label>
    {:else if data.schools.length === 1}
      <input type="hidden" name="school" value={data.schools[0]!.id} />
    {/if}
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" name="materials" checked={unit.share_materials} class="mt-1 accent-[var(--accent)]" />
      <span>
        Auch Dateien und Transkripte freigeben
        <span class="block text-xs text-muted">Aufnahmen enthalten die Stimmen anderer – nur teilen, wenn alle einverstanden sind.</span>
      </span>
    </label>
    <div class="flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (showShare = false)}>Abbrechen</button>
      <button class="btn-primary">Speichern</button>
    </div>
  </form>
{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
  <div class="min-w-0 space-y-6">
    <!-- Summary -->
    <section class="card p-5 sm:p-6">
      <div class="mb-4 flex items-center gap-2">
        <Icon name="sparkles" size={18} class="text-accent" />
        <h2 class="mr-auto font-semibold">Zusammenfassung</h2>
        {#if edit && !editingSummary}
          <button class="btn-ghost" onclick={startEditSummary}><Icon name="pencil" size={14} />Bearbeiten</button>
        {/if}
      </div>

      {#if editingSummary}
        <form
          method="POST"
          action="?/summary"
          use:enhance={() => async ({ update, result }) => {
            await update({ reset: false });
            if (result.type === "success") editingSummary = false;
          }}
        >
          <div class="mb-2 flex gap-1 text-sm">
            <button type="button" class="rounded-md px-2.5 py-1 {!preview ? 'bg-surface-2' : 'text-muted'}" onclick={() => (preview = false)}>Markdown</button>
            <button type="button" class="rounded-md px-2.5 py-1 {preview ? 'bg-surface-2' : 'text-muted'}" onclick={() => (preview = true)}>Vorschau</button>
          </div>
          {#if preview}
            <div class="prose-summary min-h-64 rounded-lg border border-border p-4">{@html renderMarkdown(draft)}</div>
            <input type="hidden" name="summary" value={draft} />
          {:else}
            <textarea class="input min-h-96 font-mono text-[13px]" name="summary" bind:value={draft}></textarea>
          {/if}
          <p class="mt-2 text-xs text-muted">Von Hand bearbeitete Zusammenfassungen werden erst überschrieben, wenn neues Material dazukommt.</p>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="btn-ghost" onclick={() => (editingSummary = false)}>Abbrechen</button>
            <button class="btn-primary">Speichern</button>
          </div>
        </form>
      {:else if unit.summary_html}
        <article class="prose-summary">{@html unit.summary_html}</article>
        <p class="mt-5 border-t border-border pt-3 text-xs text-muted">
          {unit.summary_by === "manual" ? "Bearbeitet" : "Erstellt"} {fmtDateTime(unit.summary_at)}
          {#if edit && unit.summary_due}
            · <span class="text-warn">Neues Material – wird beim nächsten Durchlauf aktualisiert</span>
          {/if}
        </p>
      {:else}
        <div class="rounded-lg bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          {#if !edit}
            Noch keine Zusammenfassung.
          {:else if data.processing}
            Das Material wird noch verarbeitet. Danach entsteht die Zusammenfassung beim nächsten Durchlauf.
          {:else if unit.summary_due}
            Die Zusammenfassung wird beim nächsten Durchlauf erstellt.
          {:else}
            Lade Aufnahmen, Dokumente oder Bilder hoch – daraus entsteht die Zusammenfassung.
          {/if}
        </div>
      {/if}
    </section>

    <!-- Materials -->
    {#if data.access.materials}
      <section class="card">
        <div class="flex gap-1 overflow-x-auto border-b border-border px-3 pt-3" role="tablist">
          {#each tabs as t}
            <button
              role="tab"
              aria-selected={tab === t.id}
              class="-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm {tab === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}"
              onclick={() => (tab = t.id)}
            >
              <Icon name={t.icon} size={15} />{t.label}
              <span class="rounded-full bg-surface-2 px-1.5 text-xs text-muted">{t.count}</span>
            </button>
          {/each}
        </div>

        <div class="p-4 sm:p-5">
          {#if tab === "audio"}
            {#each audio as f (f.id)}
              {@const badge = jobBadge(f.job)}
              <div class="border-b border-border pb-5 mb-5 last:mb-0 last:border-0 last:pb-0">
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <Icon name="microphone" size={16} class="text-muted" />
                  <span class="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span class="text-xs text-muted">
                    {f.transcript?.duration ? fmtTime(f.transcript.duration) + " · " : ""}{fmtSize(f.size)}
                  </span>
                  {#if badge}<span class="rounded-full px-2 py-0.5 text-xs {badge.cls}" title={badge.title}>{badge.text}</span>{/if}
                  {@render fileActions(f)}
                </div>
                {#if f.job?.status === "failed" && f.job.error}
                  <p class="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{f.job.error}</p>
                {/if}
                {#if f.transcript}
                  <TranscriptView fileId={f.id} transcript={f.transcript} editable={edit} />
                {:else}
                  <audio src="/files/{f.id}" controls preload="none" class="w-full"></audio>
                {/if}
              </div>
            {:else}
              <p class="py-6 text-center text-sm text-muted">Keine Aufnahmen.</p>
            {/each}
          {:else if tab === "document"}
            <ul class="divide-y divide-border">
              {#each docs as f (f.id)}
                {@const badge = jobBadge(f.job)}
                <li class="flex flex-wrap items-center gap-2 py-2.5">
                  <Icon name="file" size={16} class="text-muted" />
                  <a href="/files/{f.id}" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate hover:text-accent">{f.name}</a>
                  <span class="text-xs text-muted">{fmtSize(f.size)}</span>
                  {#if badge}<span class="rounded-full px-2 py-0.5 text-xs {badge.cls}" title={badge.title}>{badge.text}</span>{/if}
                  {#if f.kind === "other"}<span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted" title="Wird gespeichert, aber nicht ausgewertet">nur gespeichert</span>{/if}
                  {@render fileActions(f)}
                  {#if f.job?.status === "failed" && f.job.error}
                    <p class="w-full rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{f.job.error}</p>
                  {/if}
                </li>
              {:else}
                <li class="py-6 text-center text-sm text-muted">Keine Dokumente.</li>
              {/each}
            </ul>
          {:else}
            {#if images.length}
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {#each images as f (f.id)}
                  <figure class="group relative overflow-hidden rounded-lg border border-border bg-bg">
                    <a href="/files/{f.id}" target="_blank" rel="noopener">
                      <img src="/files/{f.id}" alt={f.name} loading="lazy" class="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" />
                    </a>
                    <figcaption class="flex items-center gap-1 px-2 py-1.5 text-xs">
                      <span class="min-w-0 flex-1 truncate text-muted">{f.name}</span>
                      {@render fileActions(f)}
                    </figcaption>
                  </figure>
                {/each}
              </div>
            {:else}
              <p class="py-6 text-center text-sm text-muted">Keine Bilder.</p>
            {/if}
          {/if}
        </div>
      </section>
    {/if}
  </div>

  <!-- Sidebar -->
  <aside class="space-y-4">
    {#if edit}
      <section class="card space-y-4 p-4">
        <h2 class="font-semibold">Material hinzufügen</h2>
        <Uploader unitId={unit.id} {hints} />
        <Recorder unitId={unit.id} {hints} />
        <details class="text-sm">
          <summary class="cursor-pointer text-muted hover:text-text">Optionen für Aufnahmen</summary>
          <div class="mt-3 space-y-3">
            <label class="block">
              <span class="label">Sprache</span>
              <select class="input" bind:value={hints.language}>
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
                <option value="fr">Französisch</option>
                <option value="es">Spanisch</option>
                <option value="">Automatisch erkennen</option>
              </select>
            </label>
            <div>
              <span class="label">Anzahl Sprecher (falls bekannt)</span>
              <div class="flex items-center gap-2">
                <input class="input" type="number" min="1" max="20" placeholder="min" bind:value={hints.min_speakers} />
                <span class="text-muted">–</span>
                <input class="input" type="number" min="1" max="20" placeholder="max" bind:value={hints.max_speakers} />
              </div>
            </div>
            <p class="text-xs text-muted">Gilt für die nächsten Uploads. Titel und Fach helfen Whisper bei Fachbegriffen.</p>
          </div>
        </details>
      </section>
    {/if}

    {#if data.access.materials && unit.notes.trim()}
      <section class="card p-4">
        <h2 class="mb-2 font-semibold">Notizen</h2>
        <p class="whitespace-pre-wrap text-sm text-muted">{unit.notes}</p>
      </section>
    {/if}

    {#if !data.access.materials}
      <section class="card p-4 text-sm text-muted">
        <Icon name="lock" size={16} class="mb-2" />
        Die Dateien dieser Einheit sind nicht freigegeben – nur die Zusammenfassung.
      </section>
    {/if}
  </aside>
</div>

{#snippet fileActions(f: { id: string; kind: string; job: { status: string } | null })}
  <div class="flex items-center">
    <a href="/files/{f.id}?download" class="btn-ghost px-1.5" title="Herunterladen" aria-label="Herunterladen"><Icon name="download" size={14} /></a>
    {#if edit && f.job && f.job.status === "failed"}
      <form method="POST" action="?/retry" use:enhance>
        <input type="hidden" name="file_id" value={f.id} />
        <button class="btn-ghost px-1.5" title="Erneut versuchen" aria-label="Erneut versuchen"><Icon name="refresh" size={14} /></button>
      </form>
    {/if}
    {#if edit}
      <form
        method="POST"
        action="?/deleteFile"
        use:enhance={({ cancel }) => {
          if (!confirm("Datei löschen?")) cancel();
        }}
      >
        <input type="hidden" name="file_id" value={f.id} />
        <button class="btn-ghost px-1.5 hover:text-danger" title="Löschen" aria-label="Löschen"><Icon name="trash" size={14} /></button>
      </form>
    {/if}
  </div>
{/snippet}

<script lang="ts">
  import { enhance } from "$app/forms";
  import CopyBlock from "$lib/components/CopyBlock.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { CLAUDE_TASK_PROMPT } from "$lib/claudeTask";
  import { fmtDateTime } from "$lib/format";

  let { data, form } = $props();

  const token = $derived(form && "token" in form ? (form.token as string) : "<API-TOKEN>");
  const mcpUrl = $derived(`${data.origin}/mcp`);
  const desktopConfig = $derived(JSON.stringify({
    mcpServers: {
      lessionsummary: {
        command: "npx",
        args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${AUTH_HEADER}"],
        env: { AUTH_HEADER: `Bearer ${token}` },
      },
    },
  }, null, 2));
  const codeCommand = $derived(`claude mcp add --transport http lessionsummary ${mcpUrl} --header "Authorization: Bearer ${token}"`);
</script>

<svelte:head><title>Einstellungen · LessionSummary</title></svelte:head>

<h1 class="mb-6 text-2xl font-bold">Einstellungen</h1>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
  <div class="min-w-0 space-y-6">
    <!-- Tokens -->
    <section class="card p-5">
      <h2 class="mb-1 flex items-center gap-2 font-semibold"><Icon name="key" size={18} />API-Tokens</h2>
      <p class="mb-4 text-sm text-muted">
        Für Claude (MCP) und Skripte. Ein Token darf deine Einheiten lesen und ihre Zusammenfassungen schreiben – behandle es wie ein Passwort.
      </p>

      {#if form && "token" in form}
        <div class="mb-4 rounded-lg border border-accent/50 bg-accent-soft p-3">
          <p class="mb-2 text-sm font-medium">Token „{form.name}" erstellt – es wird nur jetzt angezeigt:</p>
          <CopyBlock text={form.token as string} />
        </div>
      {/if}

      <form method="POST" action="?/create" class="mb-4 flex gap-2" use:enhance>
        <input class="input" name="name" placeholder="Name, z. B. Claude Desktop" required maxlength="80" />
        <button class="btn-primary shrink-0"><Icon name="plus" size={16} />Erstellen</button>
      </form>

      {#if data.tokens.length}
        <ul class="divide-y divide-border rounded-lg border border-border">
          {#each data.tokens as t (t.id)}
            <li class="flex items-center gap-3 px-3 py-2.5 text-sm">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{t.name}</p>
                <p class="text-xs text-muted">Erstellt {fmtDateTime(t.created_at)} · zuletzt benutzt {fmtDateTime(t.last_used_at)}</p>
              </div>
              <form method="POST" action="?/revoke" use:enhance={({ cancel }) => { if (!confirm(`Token „${t.name}" widerrufen?`)) cancel(); }}>
                <input type="hidden" name="id" value={t.id} />
                <button class="btn-danger py-1.5">Widerrufen</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Claude -->
    <section class="card space-y-4 p-5">
      <div>
        <h2 class="mb-1 flex items-center gap-2 font-semibold"><Icon name="sparkles" size={18} />Zusammenfassungen mit Claude</h2>
        <p class="text-sm text-muted">
          LessionSummary ist ein MCP-Server unter <code class="text-text">{mcpUrl}</code>. Eine geplante Aufgabe in Claude holt sich darüber alle Einheiten mit
          neuem Material und schreibt deren Zusammenfassung.
        </p>
      </div>

      <details class="group rounded-lg border border-border p-3" open>
        <summary class="cursor-pointer text-sm font-medium">Claude Desktop – Geplante Aufgaben</summary>
        <ol class="mt-3 list-decimal space-y-3 pl-5 text-sm text-muted">
          <li>
            In <code class="text-text">claude_desktop_config.json</code> eintragen (Einstellungen → Entwickler → Konfiguration bearbeiten), dann Claude Desktop neu starten:
            <div class="mt-2"><CopyBlock text={desktopConfig} /></div>
          </li>
          <li>
            Geplante Aufgabe anlegen – Häufigkeit z. B. täglich, Berechtigungen „Automatisch genehmigen" – mit diesen Anweisungen:
            <div class="mt-2"><CopyBlock text={CLAUDE_TASK_PROMPT} /></div>
          </li>
        </ol>
      </details>

      <details class="rounded-lg border border-border p-3">
        <summary class="cursor-pointer text-sm font-medium">Claude Code</summary>
        <div class="mt-3 space-y-2 text-sm text-muted">
          <CopyBlock text={codeCommand} />
          <p>Für einen unbeaufsichtigten Lauf zusammen mit dem Whisper-Worker siehe <code class="text-text">station/</code> im Repository.</p>
        </div>
      </details>
    </section>
  </div>

  <aside class="space-y-4">
    <section class="card p-4 text-sm">
      <h2 class="mb-2 font-semibold">Konto</h2>
      <p class="text-muted">Über OpenSax angemeldet. Schule und Klassen werden bei jeder Anmeldung aktualisiert.</p>
      <p class="label mt-3">Schule</p>
      <p>{data.schools.map((s) => s.name).join(", ") || "—"}</p>
      <p class="label mt-3">Klassen</p>
      <p>{data.classes.map((c) => c.name).join(", ") || "—"}</p>
    </section>
    <section class="card p-4 text-sm">
      <h2 class="mb-2 font-semibold">Verarbeitung</h2>
      <dl class="grid grid-cols-[1fr_auto] gap-y-1">
        <dt class="text-muted">Wartend</dt><dd class="tabular-nums">{data.queue.queued}</dd>
        <dt class="text-muted">Läuft</dt><dd class="tabular-nums">{data.queue.running}</dd>
        <dt class="text-muted">Fehlgeschlagen</dt><dd class="tabular-nums">{data.queue.failed}</dd>
      </dl>
      <p class="mt-2 text-xs text-muted">Transkription und Texterkennung übernimmt der Whisper-Worker, sobald er läuft.</p>
    </section>
  </aside>
</div>

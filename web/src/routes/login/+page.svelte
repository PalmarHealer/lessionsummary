<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  let { data } = $props();
</script>

<svelte:head><title>Anmelden · LessionSummary</title></svelte:head>

<div class="grid min-h-[80vh] place-items-center">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <img src="/favicon.svg" alt="" class="mx-auto mb-4 h-14 w-14" />
      <h1 class="text-2xl font-bold">LessionSummary</h1>
      <p class="mt-2 text-sm text-muted">
        Zusammenfassungen deiner Unterrichtseinheiten – aus Aufnahmen, Folien, Dokumenten und Tafelbildern.
      </p>
    </div>

    <div class="card p-5">
      {#if data.error}
        <p class="mb-4 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="alert-circle" size={16} class="mt-0.5 shrink-0" />{data.error}
        </p>
      {/if}

      {#if data.configured}
        <a href="/auth/login?next={encodeURIComponent(data.next)}" class="btn-primary w-full py-2.5">
          Mit OpenSax anmelden
          <Icon name="chevron-right" size={16} />
        </a>
        <p class="mt-3 text-center text-xs text-muted">
          Angemeldet wird mit deinem LernSax-Konto über OpenSax. LessionSummary sieht nur deinen Namen, deine Schule und deine Klassen.
        </p>
      {:else}
        <p class="text-sm text-muted">
          OpenSax ist noch nicht eingerichtet: <code>OPENSAX_URL</code> und <code>OPENSAX_CLIENT_SECRET</code> setzen.
        </p>
      {/if}

      {#if data.devLogin}
        <form method="POST" action="/auth/dev" class="mt-5 space-y-2 border-t border-border pt-4">
          <p class="label">Entwicklungs-Login</p>
          <input class="input" name="name" placeholder="Name" value="Test Schüler" required />
          <input class="input" name="school" placeholder="Schule" value="Testschule" />
          <input type="hidden" name="next" value={data.next} />
          <button class="btn w-full">Ohne OpenSax anmelden</button>
        </form>
      {/if}
    </div>
  </div>
</div>

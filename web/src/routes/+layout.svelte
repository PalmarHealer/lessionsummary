<script lang="ts">
  import "../app.css";
  import "katex/dist/katex.min.css";
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";

  let { data, children } = $props();

  const NAV = [
    { href: "/", label: "Meine Einheiten", icon: "book" },
    { href: "/shared", label: "Geteilt", icon: "users" },
    { href: "/settings", label: "Einstellungen", icon: "settings" },
  ];

  function active(href: string): boolean {
    const p = page.url.pathname;
    if (href === "/") return p === "/" || p.startsWith("/units");
    return p === href || p.startsWith(href + "/");
  }

  const initials = $derived(
    (data.user?.name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
  );
</script>

<svelte:head><title>LessionSummary</title></svelte:head>

{#if data.user}
  <header class="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
      <a href="/" class="mr-2 flex items-center gap-2 font-semibold">
        <img src="/favicon.svg" alt="" class="h-7 w-7" />
        <span class="hidden sm:inline">LessionSummary</span>
      </a>
      <nav class="flex min-w-0 flex-1 items-center gap-1">
        {#each NAV as item}
          <a
            href={item.href}
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors {active(item.href)
              ? 'bg-surface-2 text-text'
              : 'text-muted hover:text-text'}"
            aria-current={active(item.href) ? "page" : undefined}
          >
            <Icon name={item.icon} size={16} />
            <span class="hidden md:inline">{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="flex items-center gap-2">
        <span class="hidden text-right text-xs leading-tight text-muted lg:block">
          <span class="block text-sm text-text">{data.user.name}</span>
          {data.user.schools[0]?.name ?? ""}
        </span>
        <span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent" title={data.user.name}>
          {initials}
        </span>
        <form method="POST" action="/auth/logout">
          <button class="btn-ghost" title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={16} /></button>
        </form>
      </div>
    </div>
  </header>
{/if}

<main class="mx-auto w-full max-w-6xl px-4 py-6">
  {@render children()}
</main>

<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";

  interface Props {
    show: boolean;
    x: number;
    y: number;
    title?: string;
    minWidth?: string;
    onclose?: () => void;
    children?: Snippet;
  }

  let {
    show = $bindable(false),
    x = 0,
    y = 0,
    title,
    minWidth = "13rem",
    onclose,
    children,
  }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuW = $state(200);
  let menuH = $state(150);

  // Measure actual rendered size to clamp precisely within window bounds
  $effect(() => {
    if (show && menuEl) {
      menuW = menuEl.offsetWidth;
      menuH = menuEl.offsetHeight;
    }
  });

  let clampedX = $derived.by(() => {
    if (typeof window === "undefined") return x;
    return Math.max(8, Math.min(x, window.innerWidth - menuW - 12));
  });

  let clampedY = $derived.by(() => {
    if (typeof window === "undefined") return y;
    return Math.max(8, Math.min(y, window.innerHeight - menuH - 12));
  });

  function close() {
    show = false;
    onclose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && show) {
      e.stopPropagation();
      close();
    }
  }

  function handleWindowPointer(e: MouseEvent) {
    if (!show) return;
    if (menuEl && !menuEl.contains(e.target as Node)) {
      close();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("pointerdown", handleWindowPointer, true);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("pointerdown", handleWindowPointer, true);
      window.removeEventListener("scroll", close, true);
    };
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={menuEl}
    class="custom-context-menu fixed z-50 flex flex-col rounded-lg py-1 shadow-xl"
    style="top: {clampedY}px; left: {clampedX}px; min-width: {minWidth};"
    onclick={(e) => e.stopPropagation()}
    transition:scale={{ duration: 120, start: 0.96 }}
  >
    {#if title}
      <div class="ctx-header flex items-center justify-between px-3 py-1.5 text-xs font-semibold">
        <span>{title}</span>
      </div>
    {/if}

    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}

<style global lang="postcss">
  .custom-context-menu {
    border: 1px solid var(--exs-border, #334155);
    background: var(--exs-surface, #1e293b);
    color: var(--exs-text-strong, #ffffff);
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
    user-select: none;
  }

  .ctx-header {
    border-bottom: 1px solid var(--exs-border, #334155);
    color: var(--exs-text-muted, #94a3b8);
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.75rem;
    text-align: left;
    font-size: 0.75rem;
    cursor: pointer;
    background: transparent;
    border: none;
    outline: none;
    color: var(--exs-text-strong, #ffffff);
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .ctx-item:hover,
  .ctx-item:focus-visible {
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-accent, #818cf8);
  }

  .ctx-item-danger {
    color: #f87171;
  }

  .ctx-item-danger:hover,
  .ctx-item-danger:focus-visible {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
  }

  .ctx-section-title {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.45rem 0.75rem 0.2rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--exs-text-muted, #94a3b8);
  }

  .ctx-divider {
    height: 1px;
    margin: 0.25rem 0;
    background: var(--exs-border, #334155);
  }
</style>

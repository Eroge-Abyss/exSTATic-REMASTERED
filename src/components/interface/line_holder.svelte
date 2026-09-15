<script lang="ts">
  import Line from "./line.svelte";
  import { tick } from "svelte";

  interface Props {
    lines: string[][];
    onclick: () => void;
    ondblclick: ((this: Window, ev: MouseEvent) => any) | null;
  }

  let { lines = $bindable(), onclick, ondblclick }: Props = $props();
  let entry_holder: HTMLElement | undefined = $state();

  $effect.pre(() => {
    if (!entry_holder || lines.length === 0) return;

    tick().then(() => window.scrollTo(0, entry_holder?.scrollHeight ?? 0));
  });

  // Drag-select state
  let isDragging = $state(false);
  let dragAction: boolean = true; // true = check, false = uncheck
  let lastToggled: HTMLInputElement | null = null;

  function onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("line-select")) return;

    // Prevent default so the browser won't toggle the checkbox via the click
    // event that follows — we toggle it manually here instead.
    e.preventDefault();
    isDragging = true;
    const checkbox = target as HTMLInputElement;
    dragAction = !checkbox.checked;
    checkbox.checked = dragAction;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    lastToggled = checkbox;

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    const entry = el.closest(".sentence-entry");
    if (!entry) return;

    const checkbox = entry.querySelector(".line-select") as HTMLInputElement | null;
    if (!checkbox || checkbox === lastToggled || checkbox.checked === dragAction) return;

    checkbox.checked = dragAction;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    lastToggled = checkbox;
  }

  function onPointerUp() {
    isDragging = false;
    lastToggled = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function onContainerClick(e: MouseEvent) {
    // Always fire the parent's onclick (e.g. close menu).
    onclick?.();

    const target = e.target as HTMLElement;

    if (target.classList.contains("line-select")) {
      // pointerdown already toggled this checkbox and dispatched change.
      // Prevent the browser's own click default, which would toggle it again.
      e.preventDefault();
      return;
    }

    // If the user dragged to highlight text (Yomichan / copy), don't toggle.
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;

    // Clicking anywhere on a sentence row also toggles that line's checkbox.
    const entry = target.closest(".sentence-entry");
    if (!entry) return;

    const checkbox = entry.querySelector(".line-select") as HTMLInputElement | null;
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
</script>

<div
  id="entry_holder"
  bind:this={entry_holder}
  role="presentation"
  style:user-select={isDragging ? 'none' : 'auto'}
  onclick={onContainerClick}
  {ondblclick}
  onpointerdown={onPointerDown}
>
  {#each lines as [_, id, line, time]}
    <Line {id} {time} sentence={line} />
  {/each}
</div>

<style lang="postcss">
  #entry_holder {
    @apply flex h-full w-full flex-col gap-2;
    padding-bottom: var(--default-text-align);
  }
</style>

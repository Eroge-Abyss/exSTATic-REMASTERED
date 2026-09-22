<script lang="ts">
  import Line from "./line.svelte";
  import ContextMenu from "./context_menu.svelte";
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

  // Context menu state
  let showMenu = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);

  function onContainerClick(e: MouseEvent) {
    onclick?.();

    const target = e.target as HTMLElement;

    // Only respond to clicks directly on the checkbox, not the whole row.
    if (!target.classList.contains("line-select")) return;

    // The browser already toggled checked; just fire change so listeners pick it up.
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }


  function onContainerContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("line-select")) return;

    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;
    showMenu = true;
  }

  function batchSelect() {
    showMenu = false;
    if (!entry_holder) return;

    const checkboxes = Array.from(
      entry_holder.querySelectorAll<HTMLInputElement>(".line-select"),
    );

    const checkedIndices = checkboxes
      .map((cb, i) => (cb.checked ? i : -1))
      .filter((i) => i !== -1);

    if (checkedIndices.length < 2) return;

    const min = Math.min(...checkedIndices);
    const max = Math.max(...checkedIndices);

    for (let i = min; i <= max; i++) {
      if (!checkboxes[i].checked) {
        checkboxes[i].checked = true;
        checkboxes[i].dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
</script>

<ContextMenu bind:show={showMenu} x={menuX} y={menuY} title="Selection">
  <button class="ctx-item" onclick={batchSelect}>
    ⬛ Batch Select
  </button>
</ContextMenu>

<div
  id="entry_holder"
  bind:this={entry_holder}
  role="presentation"
  onclick={onContainerClick}
  oncontextmenu={onContainerContextMenu}
  {ondblclick}
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

<script lang="ts">
  import type { ScaleLinear, ScaleTime } from "d3";
  import type { DataEntry } from "../../data_wrangling/data_extraction";

  interface Props {
    data: DataEntry[];
    xGet: (d: DataEntry) => number | undefined;
    yGet: (d: DataEntry) => number | undefined;
    rGet: (d: DataEntry) => number | undefined;
    cGet: (d: DataEntry) => string;
    x_scale?: ScaleTime<number, number, never>;
    y_scale?: ScaleLinear<number, number>;
    mouse_move: (event: MouseEvent) => void;
    mouse_out: () => void;
    selectedGroup?: string | null;
    hoveredGroup?: string | null;
    groupAccessor?: (d: DataEntry) => string;
    onbubblehover?: (group: string | null) => void;
  }

  let {
    data = $bindable(),
    xGet,
    yGet,
    rGet,
    cGet,
    x_scale,
    y_scale,
    mouse_move = $bindable(),
    mouse_out = $bindable(),
    selectedGroup = null,
    hoveredGroup = null,
    groupAccessor,
    onbubblehover,
  }: Props = $props();

  let ready = $derived(
    x_scale !== undefined &&
      y_scale !== undefined &&
      rGet !== undefined &&
      cGet !== undefined,
  );

  // Single-circle click selection
  let selectedIndex = $state<number | null>(null);
  let hoveredIndex = $state<number | null>(null);

  function getOpacity(d: DataEntry, index: number): number {
    // Single circle clicked — only that one is full opacity
    if (selectedIndex !== null) {
      return index === selectedIndex ? 1.0 : 0.15;
    }
    // Single circle hovered — only that one is full opacity
    if (hoveredIndex !== null) {
      return index === hoveredIndex ? 1.0 : 0.15;
    }
    if (!groupAccessor) return 0.8;
    const grp = groupAccessor(d);
    // Legend group selected
    if (selectedGroup) {
      return grp === selectedGroup ? 0.9 : 0.15;
    }
    // Hover
    if (hoveredGroup) {
      return grp === hoveredGroup ? 1.0 : 0.2;
    }
    return 0.8;
  }

  function handleClick(index: number) {
    selectedIndex = selectedIndex === index ? null : index;
  }

  function handleMouseEnter(d: DataEntry, index: number) {
    hoveredIndex = index;
    if (groupAccessor && onbubblehover) {
      onbubblehover(groupAccessor(d));
    }
  }

  function handleMouseLeave() {
    hoveredIndex = null;
    if (onbubblehover) {
      onbubblehover(null);
    }
  }
</script>

<!-- svelte-ignore a11y_mouse_events_have_key_events -->
{#if ready}
  {#each data as d, i}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <circle
      data-index={i}
      cx={xGet(d)}
      cy={yGet(d)}
      r={rGet(d)}
      fill={cGet(d)}
      fill-opacity={getOpacity(d, i)}
      class="z-10"
      role="graphics-symbol"
      aria-roledescription="circle"
      onmousemove={mouse_move}
      onmouseout={() => {
        mouse_out();
        handleMouseLeave();
      }}
      onmouseenter={() => handleMouseEnter(d, i)}
      onclick={() => handleClick(i)}
      style="transition: cx 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), cy 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), r 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), fill 0.5s ease, fill-opacity 0.15s ease; cursor: pointer;"
    />
  {/each}
{/if}

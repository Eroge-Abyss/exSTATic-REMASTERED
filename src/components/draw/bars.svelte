<script lang="ts">
  import type { DataEntry } from "../../data_wrangling/data_extraction";

  interface Props {
    data: Partial<DataEntry>[];
    xGet: (d: Partial<DataEntry>) => number | undefined;
    yGet: (d: Partial<DataEntry>) => number | undefined;
    hGet: (d: Partial<DataEntry>) => number | undefined;
    cGet: (d: Partial<DataEntry>) => string | number | undefined;
    bar_width: number;
    mouse_move: (event: MouseEvent) => void;
    mouse_out: () => void;
    highlight_start?: string;
    highlight_end?: string;
    highlight_dates?: Set<string>;
    hovered_index?: number | null;
  }

  let {
    data = $bindable(),
    xGet,
    yGet,
    hGet,
    cGet,
    bar_width,
    mouse_move,
    mouse_out,
    highlight_start,
    highlight_end,
    highlight_dates,
    hovered_index = null,
  }: Props = $props();

  let ready: boolean = $derived(
    xGet !== undefined &&
      yGet !== undefined &&
      hGet !== undefined &&
      cGet !== undefined,
  );

  function getOpacity(d: Partial<DataEntry>, i: number): string {
    const isSingleDayTarget =
      highlight_start && highlight_end && highlight_start === highlight_end;

    if (hovered_index !== null) {
      if (i === hovered_index) return "1";
      if (isSingleDayTarget) {
        return d.date === highlight_start ? "0.6" : "0.15";
      }
      if (highlight_dates) {
        return d.date && highlight_dates.has(d.date) ? "0.6" : "0.15";
      }
      if (highlight_start && highlight_end && d.date) {
        return d.date >= highlight_start && d.date <= highlight_end
          ? "0.6"
          : "0.15";
      }
      return "0.65";
    }

    if (isSingleDayTarget) {
      return d.date === highlight_start ? "0.85" : "0.2";
    }
    if (highlight_dates) {
      return d.date && highlight_dates.has(d.date) ? "0.85" : "0.2";
    }
    if (highlight_start && highlight_end && d.date) {
      return d.date >= highlight_start && d.date <= highlight_end
        ? "0.85"
        : "0.2";
    }
    return "0.85";
  }
</script>

<!-- svelte-ignore a11y_mouse_events_have_key_events -->
{#if ready}
  {#each data as d, i}
    <rect
      data-index={i}
      x={xGet(d)}
      y={yGet(d)}
      height={hGet(d)}
      width={bar_width}
      fill={cGet(d)?.toString()}
      fill-opacity={getOpacity(d, i)}
      rx="3"
      ry="3"
      class="z-10"
      role="graphics-symbol"
      aria-roledescription="bar"
      onmousemove={mouse_move}
      onmouseout={mouse_out}
      style="transition: x 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), y 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), fill 0.5s ease, fill-opacity 0.15s ease;"
    />
  {/each}
{/if}

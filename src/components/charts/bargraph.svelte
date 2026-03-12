<script lang="ts">
  import LineAxis from "../draw/oriented_axis.svelte";
  import Bars from "../draw/bars.svelte";
  import Popup, {
    type TooltipAccessors,
    type TooltipFormatters,
  } from "./popup.svelte";

  import { group, max, extent } from "d3-array";
  import { format } from "d3-format";
  import iwanthue from "iwanthue";
  import { scaleLinear, scaleBand, scaleLog } from "d3-scale";
  import { interpolateRgb } from "d3-interpolate";
  import type { DataEntry } from "../../data_wrangling/data_extraction";
  import * as browser from "webextension-polyfill";

  // Heatmap gradient mapping sync
  interface Props {
    data: Partial<DataEntry>[];
    x_accessor: (d: Partial<DataEntry>) => string;
    y_accessor: (d: Partial<DataEntry>) => number;
    c_accessor: (d: Partial<DataEntry>) => string;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    graph_title: string;
    x_label: string;
    y_label: string;
    tabs?: { label: string }[];
    activeTab?: number;
    ontabchange?: (index: number) => void;
    mouse_move?: (event: MouseEvent) => void;
    mouse_out?: () => void;
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
  }

  let {
    data,
    x_accessor,
    y_accessor,
    c_accessor,
    tooltip_accessors,
    tooltip_formatters,
    graph_title,
    x_label,
    y_label,
    tabs,
    activeTab = 0,
    ontabchange,
    mouse_move = $bindable(() => {}),
    mouse_out = $bindable(() => {}),
    color_overrides = {},
    oncolorchange,
  }: Props = $props();

  let matchScatterColors = $state(false);

  // Load persisted color mode
  browser.storage.local.get("bargraph_match_colors").then((result) => {
    if (result["bargraph_match_colors"] !== undefined) {
      matchScatterColors = result["bargraph_match_colors"];
    }
  });

  function toggleMatchScatterColors() {
    matchScatterColors = !matchScatterColors;
    browser.storage.local.set({ bargraph_match_colors: matchScatterColors });
  }

  // Sort
  let sortMode = $state<"original" | "ascending" | "descending">("original");
  let useLogScale = $state(false);

  let hoveredIndex = $state<number | null>(null);

  function hitZoneMove(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target) {
      const indexStr = target.getAttribute("data-index");
      if (indexStr !== null) {
        hoveredIndex = parseInt(indexStr);
      }
    }
    if (mouse_move) mouse_move(e);
  }

  function hitZoneOut() {
    hoveredIndex = null;
    if (mouse_out) mouse_out();
  }

  let sortedData = $derived.by(() => {
    const d = [...data];
    if (sortMode === "ascending") {
      d.sort((a, b) => (y_accessor(a) || 0) - (y_accessor(b) || 0));
    } else if (sortMode === "descending") {
      d.sort((a, b) => (y_accessor(b) || 0) - (y_accessor(a) || 0));
    }
    return d;
  });

  function cycleSortMode() {
    if (sortMode === "original") sortMode = "descending";
    else if (sortMode === "descending") sortMode = "ascending";
    else sortMode = "original";
  }

  let sortLabel = $derived(
    sortMode === "descending"
      ? "sorted descending"
      : sortMode === "ascending"
        ? "sorted ascending"
        : "original order",
  );

  let colorScale = $derived.by(() => {
    const color_extent = extent(data, y_accessor);
    return color_extent[0] !== undefined && color_extent[1] !== undefined
      ? scaleLinear<string>().domain(color_extent).range(["#818cf8", "#4338ca"])
      : undefined;
  });

  let groups = $derived(Array.from(new Set(data.map((d) => c_accessor(d)))));
  let hues = $derived(
    groups.length > 0
      ? iwanthue(groups.length, {
          colorSpace: [0, 360, 0, 100, 50, 100],
          clustering: "force-vector",
          seed: "exSTATic!",
        })
      : [],
  );

  function getRankedColor(d: Partial<DataEntry>): string {
    const val = y_accessor(d);
    return colorScale && val !== undefined ? colorScale(val) : "#818cf8";
  }

  function getCategoricalColor(d: Partial<DataEntry>): string {
    const name = c_accessor(d);
    if (color_overrides && color_overrides[name]) return color_overrides[name];
    const idx = groups.indexOf(name);
    return hues[idx] ?? "#a78bfa";
  }

  function getColor(d: Partial<DataEntry>): string {
    return matchScatterColors ? getCategoricalColor(d) : getRankedColor(d);
  }

  // Margins
  const marginTop = 10;
  const marginRight = 10;
  const marginBottom = 70;
  const marginLeft = 55;

  let [height, width] = $state([600, 1200]);
  let safeWidth = $derived(Math.max(width, 400));
  let safeHeight = $derived(Math.max(height, 300));

  let x_range = $derived([marginLeft, safeWidth - marginRight]);
  let y_range = $derived([safeHeight - marginBottom, marginTop]);

  let x_scale = $derived(
    scaleBand().domain(sortedData.map(x_accessor)).range(x_range).padding(0.45),
  );

  let y_scale = $derived.by(() => {
    const yM = max(sortedData, y_accessor) ?? 1;
    if (useLogScale) {
      const yMin = Math.max(
        1,
        Math.min(...sortedData.map(y_accessor).filter((v) => v > 0)),
      );
      return scaleLog()
        .domain([yMin, yM * 1.2])
        .range(y_range)
        .nice()
        .clamp(true);
    }
    return scaleLinear()
      .domain([0, yM * 1.02])
      .range(y_range)
      .nice();
  });

  const xGet = (d: Partial<DataEntry>) => x_scale(x_accessor(d));
  const yGet = (d: Partial<DataEntry>) => y_scale(y_accessor(d));
  const cGet = (d: Partial<DataEntry>) => getColor(d);
  const hGet = (d: Partial<DataEntry>) => {
    const yVal = yGet(d);
    if (yVal === undefined) return 0;
    return Math.max(0, safeHeight - marginBottom - yVal);
  };

  let bar_width = $derived(x_scale.bandwidth());
  let gridTicks = $derived(
    y_scale.ticks ? y_scale.ticks(useLogScale ? 10 : 6) : [],
  );

  const valueFmt = format(".3~s");
  const y_formatter = (n: number | { valueOf(): number }) =>
    format(".2~s")(typeof n === "number" ? n : n.valueOf());
  const x_formatter = (x_value: string) => x_value;
</script>

<div class="bg-wrap">
  <!-- Header -->
  {#if tabs && tabs.length > 0}
    <h2 class="bg-title">{tabs[activeTab]?.label ?? graph_title}</h2>
  {:else}
    <h2 class="bg-title">{graph_title}</h2>
  {/if}
  <p class="bg-subtitle">{y_label} · {sortLabel}</p>

  <!-- Tabs (if provided) -->
  {#if tabs && tabs.length > 0}
    <div class="bg-tabs">
      {#each tabs as tab, i}
        <button
          class="bg-tab"
          class:bg-tab-active={activeTab === i}
          onclick={() => ontabchange?.(i)}>{tab.label}</button
        >
      {/each}
    </div>
  {/if}

  <!-- Controls (top left) -->
  <div class="bg-controls-left">
    <button
      class="bg-btn"
      class:bg-btn-on={matchScatterColors}
      onclick={toggleMatchScatterColors}
      title="Match colors with the scatterplot"
    >
      COLOR
    </button>
  </div>

  <!-- Controls (top right) -->
  <div class="bg-controls">
    <button class="bg-btn" onclick={cycleSortMode}>
      {sortMode === "descending"
        ? "SORT ↓"
        : sortMode === "ascending"
          ? "SORT ↑"
          : "SORT •"}
    </button>
    <button
      class="bg-btn"
      class:bg-btn-on={useLogScale}
      onclick={() => (useLogScale = !useLogScale)}>LOG</button
    >
  </div>

  <!-- Chart -->
  <figure class="bg-figure" bind:clientHeight={height} bind:clientWidth={width}>
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 {safeWidth} {safeHeight}"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="clip-bg-{graph_title.replace(/\s/g, '')}">
          <rect
            x={marginLeft}
            y={0}
            width={safeWidth - marginLeft - marginRight}
            height={safeHeight - marginBottom + 4}
          />
        </clipPath>
      </defs>

      <!-- Gridlines -->
      {#each gridTicks as tick}
        <line
          x1={marginLeft}
          x2={safeWidth - marginRight}
          y1={y_scale(tick)}
          y2={y_scale(tick)}
          stroke="#818cf8"
          stroke-opacity="0.15"
          stroke-dasharray="4,4"
        />
      {/each}

      <!-- Axes -->
      <LineAxis
        scale={x_scale}
        height={safeHeight}
        width={safeWidth}
        margin={marginLeft}
        position="bottom"
        formatter={x_formatter}
        label=""
      />
      <LineAxis
        scale={y_scale}
        height={safeHeight}
        width={safeWidth}
        margin={marginLeft}
        position="left"
        formatter={y_formatter}
        label=""
      />

      <!-- Bars + value labels -->
      <g clip-path="url(#clip-bg-{graph_title.replace(/\s/g, '')})">
        <Bars
          data={sortedData}
          {xGet}
          {yGet}
          {hGet}
          {cGet}
          {bar_width}
          mouse_move={hitZoneMove}
          mouse_out={hitZoneOut}
          hovered_index={hoveredIndex}
        />

        {#each sortedData as d, i}
          {@const x = xGet(d)}
          {@const y = yGet(d)}
          {@const color = cGet(d)}
          {#if x !== undefined && y !== undefined}
            <!-- Full-column invisible hit zone -->
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              data-index={i}
              {x}
              y={marginTop}
              width={bar_width}
              height={Math.max(0, safeHeight - marginBottom - marginTop)}
              fill="rgba(255, 255, 255, 0.05)"
              opacity={hoveredIndex === i ? 1 : 0}
              class="cursor-pointer"
              onmousemove={hitZoneMove}
              onmouseout={hitZoneOut}
              style="transition: opacity 0.2s ease;"
            />

            <text
              x={x + bar_width / 2}
              y={Math.max(y - 6, 14)}
              text-anchor="middle"
              fill={color}
              font-size="11"
              font-weight="600"
              opacity="0.9"
              pointer-events="none"
              style="transition: x 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), y 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), fill 0.5s ease;"
              >{valueFmt(y_accessor(d))}</text
            >
          {/if}
        {/each}
      </g>
    </svg>

    <Popup
      data={sortedData}
      groups={sortedData.map((d) => c_accessor(d))}
      hues={sortedData.map((d) => getColor(d))}
      group_accessor={c_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>
</div>

<style>
  .bg-wrap {
    background: #0f172a;
    border-radius: 12px;
    padding: 18px 16px 10px;
    width: 100%;
    position: relative;
  }
  .bg-title {
    text-align: center;
    font-size: 1.3rem;
    font-weight: 700;
    color: #818cf8;
    margin: 0;
    background: transparent;
    padding: 0;
    border: none;
  }
  .bg-subtitle {
    text-align: center;
    font-size: 0.72rem;
    color: #818cf8;
    margin: 2px 0 4px;
    letter-spacing: 0.02em;
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }
  .bg-controls {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 6px;
  }
  .bg-controls-left {
    position: absolute;
    left: 80px;
    top: 24px;
    display: flex;
    gap: 8px;
  }
  .bg-btn {
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 5px 12px;
    color: #818cf8;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
  }
  .bg-btn:hover {
    color: #fff;
  }
  :global(.bg-btn-on) {
    background: #818cf8 !important;
    color: #fff !important;
    font-weight: 500 !important;
  }
  .bg-figure {
    position: relative;
    width: 100%;
    height: 462px;
  }
  .bg-tabs {
    display: flex;
    gap: 4px;
    justify-content: center;
    margin: 8px 0 4px;
    background: transparent;
    border: none;
    border-radius: 12px;
    padding: 4px;
    width: fit-content;
    margin-left: auto;
    margin-right: auto;
  }
  .bg-tab {
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    color: #818cf8;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
  }
  .bg-tab:hover {
    color: #fff;
  }
  :global(.bg-tab-active) {
    background: #818cf8 !important;
    color: #fff !important;
    font-weight: 500 !important;
  }
</style>

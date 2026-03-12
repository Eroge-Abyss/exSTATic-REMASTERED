<script lang="ts">
  import LineAxis from "../draw/oriented_axis.svelte";
  import Circles from "../draw/circles.svelte";
  import Popup, {
    type TooltipAccessors,
    type TooltipFormatters,
  } from "./popup.svelte";
  import Legend from "../draw/legend.svelte";

  import { extent, group } from "d3-array";
  import { format } from "d3-format";
  import { timeFormat } from "d3-time-format";
  import { scaleLinear, scaleTime } from "d3-scale";
  import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
  import { select } from "d3-selection";
  import iwanthue from "iwanthue";
  import type { DataEntry } from "../../data_wrangling/data_extraction";
  import { onMount } from "svelte";
  import * as browser from "webextension-polyfill";

  interface Props {
    data: DataEntry[];
    x_accessor: (d: Partial<DataEntry>) => Date;
    y_accessor: (d: DataEntry) => number;
    r_accessor: (d: Partial<DataEntry>) => number;
    c_accessor: (d: Partial<DataEntry>) => string;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    graph_title: string;
    x_label: string;
    y_label: string;
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
    tabs?: { label: string }[];
    activeTab?: number;
    ontabchange?: (index: number) => void;
    onselect?: (group: string | null) => void;
  }

  let {
    data,
    x_accessor,
    y_accessor,
    r_accessor,
    c_accessor,
    tooltip_accessors,
    tooltip_formatters,
    graph_title,
    x_label,
    y_label,
    color_overrides = {},
    oncolorchange,
    tabs,
    activeTab = 0,
    ontabchange,
    onselect,
  }: Props = $props();

  let radius = 75;

  let disableAnimations = $state(false);

  let groups = $derived(Array.from(group(data, c_accessor).keys()));
  let hues = $derived(
    groups.length > 0
      ? iwanthue(groups.length, {
          colorSpace: [0, 360, 0, 100, 50, 100],
          clustering: "force-vector",
          seed: "exSTATic!",
        })
      : [],
  );

  function getColor(name: string): string {
    if (color_overrides[name]) return color_overrides[name];
    const idx = groups.indexOf(name);
    return hues[idx] ?? "#a78bfa";
  }

  let [height, width, margin] = $state([480, 1200, 50]);
  let safeHeight = $derived.by(() => {
    const minHeight = Math.max(height, 500);
    return minHeight > width ? width : minHeight;
  });
  let safeWidth = $derived(Math.max(width, 500));

  let x_range = $derived([radius + margin, safeWidth - radius - margin]);
  let y_range = $derived([safeHeight - margin - 15, margin + 40]);

  let base_x_scale = $derived.by(() => {
    const scale_extent = x_accessor && extent(data, x_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      return scaleTime().domain(scale_extent).range(x_range).nice();
    }
  });
  let base_y_scale = $derived.by(() => {
    const scale_extent = y_accessor && extent(data, y_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      const padding =
        (scale_extent[1] - scale_extent[0]) * 0.1 || scale_extent[1] * 0.1 || 1;
      return scaleLinear()
        .domain([scale_extent[0], scale_extent[1] + padding])
        .range(y_range)
        .nice();
    }
  });
  let r_scale = $derived.by(() => {
    const scale_extent = r_accessor && extent(data, r_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      return scaleLinear().domain(scale_extent).range([0, radius]);
    }
  });

  // Zoom
  let zoomEnabled = $state(false);
  let currentTransform: ZoomTransform = $state(zoomIdentity);
  let isZoomed = $derived(
    currentTransform.k !== 1 ||
      currentTransform.x !== 0 ||
      currentTransform.y !== 0,
  );

  let x_scale = $derived(
    base_x_scale ? currentTransform.rescaleX(base_x_scale) : undefined,
  );
  let y_scale = $derived(
    base_y_scale ? currentTransform.rescaleY(base_y_scale) : undefined,
  );

  const xGet = (d: Partial<DataEntry>) => x_scale && x_scale(x_accessor(d));
  const yGet = (d: DataEntry) => y_scale && y_scale(y_accessor(d));
  const rGet = (d: DataEntry) => {
    if (!r_accessor || !r_scale) return undefined;
    return r_scale(r_accessor(d)) * Math.sqrt(currentTransform.k);
  };
  const cGet = (d: DataEntry) => getColor(c_accessor(d));

  const [x_formatter, y_formatter] = [timeFormat("%B\n%Y"), format(".2s")];

  let mouse_move: (event: MouseEvent) => void = $state(() => {});
  let mouse_out: () => void = $state(() => {});

  // Interactive legend state
  let selectedGroup = $state<string | null>(null);
  let hoveredGroup = $state<string | null>(null);

  function handleLegendSelect(grp: string | null) {
    selectedGroup = grp;
    if (onselect) onselect(grp);

    if (grp && svgElement && zoomBehaviorRef && base_x_scale && base_y_scale) {
      const gData = data.filter((d) => c_accessor(d) === grp);
      if (gData.length > 0) {
        const xExt = extent(gData, x_accessor) as [Date, Date];
        const yExt = extent(gData, y_accessor) as [number, number];

        const x0 = base_x_scale(xExt[0]);
        const x1 = base_x_scale(xExt[1]);
        const y0 = base_y_scale(yExt[1]);
        const y1 = base_y_scale(yExt[0]);

        const dx = Math.abs(x1 - x0) || 1;
        const dy = Math.abs(y1 - y0) || 1;
        const xCenter = (x0 + x1) / 2;
        const yCenter = (y0 + y1) / 2;

        const max_r = Math.max(
          1,
          ...gData.map((d) =>
            r_scale && r_accessor ? r_scale(r_accessor(d)) || 0 : 0,
          ),
        );

        const padX = safeWidth - margin * 2;
        const padY = safeHeight - margin * 2;
        const targetPadX = padX * 0.95;
        const targetPadY = padY * 0.95;

        const Sx =
          dx > 0
            ? (-2 * max_r +
                Math.sqrt(4 * max_r * max_r + 4 * dx * targetPadX)) /
              (2 * dx)
            : 10;
        const Sy =
          dy > 0
            ? (-2 * max_r +
                Math.sqrt(4 * max_r * max_r + 4 * dy * targetPadY)) /
              (2 * dy)
            : 10;
        const scale = Math.max(1, Math.min(20, Math.min(Sx * Sx, Sy * Sy)));

        // Offset y center upwards so circles rest downwards inside the box
        const yOffset = (max_r * Math.sqrt(scale)) / 2;
        const translate = [
          safeWidth / 2 - scale * xCenter,
          safeHeight / 2 - scale * yCenter + yOffset,
        ];

        select(svgElement)
          .transition()
          .duration(disableAnimations ? 0 : 750)
          .call(
            zoomBehaviorRef.transform,
            zoomIdentity.translate(translate[0], translate[1]).scale(scale),
          );
      }
    } else if (svgElement && zoomBehaviorRef) {
      select(svgElement)
        .transition()
        .duration(disableAnimations ? 0 : 750)
        .call(zoomBehaviorRef.transform, zoomIdentity);
    }
  }

  function handleBubbleHover(grp: string | null) {
    hoveredGroup = grp;
  }

  let svgElement: SVGSVGElement;
  let zoomBehaviorRef: any = null;

  onMount(async () => {
    const res = await browser.storage.local.get("disable_animations");
    disableAnimations = !!res.disable_animations;

    if (!svgElement) return;
    zoomBehaviorRef = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .on("zoom", (event) => {
        currentTransform = event.transform;
      });
  });

  function toggleZoom() {
    zoomEnabled = !zoomEnabled;
    if (!svgElement || !zoomBehaviorRef) return;
    if (zoomEnabled) {
      select(svgElement).call(zoomBehaviorRef);
      svgElement.style.cursor = "grab";
    } else {
      select(svgElement).on(".zoom", null);
      svgElement.style.cursor = "default";
      select(svgElement)
        .transition()
        .duration(disableAnimations ? 0 : 300)
        .call(zoomBehaviorRef.transform, zoomIdentity);
    }
  }

  function resetZoom() {
    if (!svgElement || !zoomBehaviorRef) return;
    select(svgElement)
      .transition()
      .duration(disableAnimations ? 0 : 300)
      .call(zoomBehaviorRef.transform, zoomIdentity);
  }
</script>

<div class="sp-wrap">
  <!-- Controls (top right) -->
  <div class="sp-controls">
    <button class="sp-btn" class:sp-btn-on={zoomEnabled} onclick={toggleZoom}
      >🔍 ZOOM</button
    >
    {#if isZoomed}
      <button class="sp-btn" onclick={resetZoom}>RESET</button>
    {/if}
  </div>

  <!-- Header matching bar chart style -->
  {#if tabs && tabs.length > 0}
    <h2 class="sp-title">{tabs[activeTab]?.label ?? graph_title}</h2>
  {:else}
    <h2 class="sp-title">{graph_title}</h2>
  {/if}
  <p class="sp-subtitle">{y_label}</p>

  <!-- Tabs (if provided) -->
  {#if tabs && tabs.length > 0}
    <div class="sp-tabs">
      {#each tabs as tab, i}
        <button
          class="sp-tab"
          class:sp-tab-active={activeTab === i}
          onclick={() => ontabchange?.(i)}>{tab.label}</button
        >
      {/each}
    </div>
  {/if}

  <figure bind:clientHeight={height} bind:clientWidth={width} class="sp-figure">
    <svg
      bind:this={svgElement}
      height="100%"
      width="100%"
      class="max-h-[48vh]"
      viewBox="0 0 {safeWidth} {safeHeight}"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="clip-sp-{graph_title.replace(/\s/g, '')}">
          <rect
            x={10}
            y={10}
            width={Math.max(1, safeWidth - 20)}
            height={Math.max(1, safeHeight - 10)}
          />
        </clipPath>
      </defs>

      <LineAxis
        scale={x_scale}
        height={safeHeight}
        width={safeWidth}
        {margin}
        position="bottom"
        formatter={x_formatter}
        label={x_label}
      />
      <LineAxis
        scale={y_scale}
        height={safeHeight}
        width={safeWidth}
        {margin}
        position="left"
        formatter={y_formatter}
        label={y_label}
      />

      <g clip-path="url(#clip-sp-{graph_title.replace(/\s/g, '')})">
        <Circles
          {data}
          {xGet}
          {yGet}
          {rGet}
          {cGet}
          {x_scale}
          {y_scale}
          {selectedGroup}
          {hoveredGroup}
          groupAccessor={(d) => c_accessor(d)}
          onbubblehover={handleBubbleHover}
          bind:mouse_move
          bind:mouse_out
        />
      </g>
    </svg>

    <Popup
      {data}
      {groups}
      hues={groups.map(getColor)}
      date_accessor={x_accessor}
      group_accessor={c_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>

  <!-- Legend pills at bottom -->
  <Legend
    {groups}
    hues={groups.map(getColor)}
    {selectedGroup}
    {hoveredGroup}
    {color_overrides}
    {oncolorchange}
    onselect={handleLegendSelect}
  />
</div>

<style>
  .sp-wrap {
    background: #0f172a;
    border-radius: 12px;
    padding: 18px 16px 10px;
    width: 100%;
    position: relative;
  }
  .sp-title {
    text-align: center;
    font-size: 1.3rem;
    font-weight: 700;
    color: #818cf8;
    text-shadow: 0 0 12px rgba(129, 140, 248, 0.4);
    margin: 0;
  }
  .sp-subtitle {
    text-align: center;
    font-size: 0.72rem;
    color: #818cf8;
    margin: 2px 0 4px;
    letter-spacing: 0.02em;
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }
  .sp-controls {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 6px;
  }
  .sp-btn {
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
  .sp-btn:hover {
    color: #fff;
  }
  :global(.sp-btn-on) {
    background: #818cf8 !important;
    color: #fff !important;
    font-weight: 500 !important;
    box-shadow: 0 0 16px rgba(129, 140, 248, 0.4) !important;
  }
  .sp-figure {
    position: relative;
    width: 100%;
  }
  .sp-tabs {
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
  .sp-tab {
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
  .sp-tab:hover {
    color: #fff;
  }
  :global(.sp-tab-active) {
    background: #818cf8 !important;
    color: #fff !important;
    font-weight: 500 !important;
    box-shadow: 0 0 16px rgba(129, 140, 248, 0.4) !important;
  }
</style>

<script lang="ts">
  import LineAxis from "../draw/oriented_axis.svelte";
  import Bars from "../draw/bars.svelte";
  import Popup, {
    type TooltipAccessors,
    type TooltipFormatters,
  } from "./popup.svelte";
  import Legend from "../draw/legend.svelte";

  import { extent, group } from "d3-array";
  import { format } from "d3-format";
  import { scaleLinear, scaleBand } from "d3-scale";
  import { zoom, zoomIdentity } from "d3-zoom";
  import { select } from "d3-selection";
  import iwanthue from "iwanthue";
  import type { DataEntry } from "../../data_wrangling/data_extraction";
  import { onMount } from "svelte";

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
    color_overrides = {},
    oncolorchange,
  }: Props = $props();

  let groups = $derived(Array.from(group(data, c_accessor).keys()));
  let hues = $derived(
    iwanthue(groups.length, {
      colorSpace: [0, 360, 0, 100, 50, 100],
      clustering: "force-vector",
      seed: "exSTATic!",
    }),
  );

  let [height, width, margin] = $state([1000, 1200, 50]);
  let safeHeight = $derived.by(() => {
    const minHeight = Math.max(height, 500);
    return minHeight > width ? width : minHeight;
  });
  let safeWidth = $derived(Math.max(width, 500));

  // Physical ranges shrink in proport to the maximal circle radius and padding
  let x_range = $derived([margin, safeWidth - margin]);
  let y_range = $derived([safeHeight - margin, margin]);

  // Base (unzoomed) scales
  let base_x_scale = $derived(
    scaleBand().domain(data.map(x_accessor)).range(x_range),
  );
  let base_y_scale = $derived.by(() => {
    const scale_extent = y_accessor && extent(data, y_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      return scaleLinear().domain(scale_extent).range(y_range).nice();
    }
  });

  // Zoom state — x-axis only for bar chart
  let zoomK = $state(1);
  let zoomX = $state(0);
  let isZoomed = $state(false);

  // Zoomed x scale: shift and scale the range
  let x_scale = $derived.by(() => {
    const newRange = x_range.map((r) => r * zoomK + zoomX);
    return scaleBand().domain(data.map(x_accessor)).range(newRange);
  });
  let y_scale = $derived(base_y_scale);

  const xGet = (d: Partial<DataEntry>) => x_scale(x_accessor(d));
  const yGet = (d: Partial<DataEntry>) => y_scale && y_scale(y_accessor(d));
  const cGet = (d: Partial<DataEntry>) => {
    const name = c_accessor(d);
    return color_overrides[name] ?? hues[groups.indexOf(name)];
  };
  const hGet = (d: Partial<DataEntry>) => {
    const yValue = yGet(d);
    if (!yValue) return;
    return Math.max(0, safeHeight - margin - yValue);
  };

  let bar_width = $derived(x_scale.bandwidth());

  const [x_formatter, y_formatter] = [
    (x_value: string) => x_value,
    format(".2s"),
  ];

  let mouse_move: (event: MouseEvent) => void = $state(() => {});
  let mouse_out: () => void = $state(() => {});

  // d3-zoom setup — constrained to x-axis
  let svgElement: SVGSVGElement;

  onMount(() => {
    if (!svgElement) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([
        [0, 0],
        [safeWidth, safeHeight],
      ])
      .on("zoom", (event) => {
        zoomK = event.transform.k;
        zoomX = event.transform.x;
        isZoomed = event.transform.k !== 1 || event.transform.x !== 0;
      });

    select(svgElement).call(zoomBehavior);
    (svgElement as any).__zoomBehavior = zoomBehavior;
  });

  function resetZoom() {
    if (!svgElement) return;
    const zoomBehavior = (svgElement as any).__zoomBehavior;
    if (zoomBehavior) {
      select(svgElement)
        .transition()
        .duration(300)
        .call(zoomBehavior.transform, zoomIdentity);
    }
    isZoomed = false;
  }
</script>

<div
  class="flex h-full w-full flex-col items-center bg-slate-900 p-12 relative"
>
  <h1 class="text-4xl font-semibold text-indigo-400">{graph_title}</h1>

  {#if isZoomed}
    <button
      class="absolute top-4 right-4 z-50 rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500 transition-colors"
      onclick={resetZoom}
    >
      Reset Zoom
    </button>
  {/if}

  <figure
    bind:clientHeight={height}
    bind:clientWidth={width}
    class="flex h-full w-full flex-row items-center"
  >
    <svg
      bind:this={svgElement}
      height="100%"
      width="100%"
      class="max-h-[80vh]"
      style="resize: both; cursor: grab;"
      viewBox="0 0 {safeWidth} {safeHeight}"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="chart-area-bar-{graph_title.replace(/\s/g, '')}">
          <rect
            x={margin}
            y={margin}
            width={safeWidth - 2 * margin}
            height={safeHeight - 2 * margin}
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

      <g clip-path="url(#chart-area-bar-{graph_title.replace(/\s/g, '')})">
        <Bars
          {data}
          {xGet}
          {yGet}
          {hGet}
          {cGet}
          {bar_width}
          {mouse_move}
          {mouse_out}
        />
      </g>
    </svg>

    <Legend {groups} {hues} {color_overrides} {oncolorchange} />

    <Popup
      {data}
      {groups}
      {hues}
      group_accessor={c_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>
</div>

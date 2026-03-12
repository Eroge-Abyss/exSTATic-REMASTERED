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
  }: Props = $props();

  let radius = 60;

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
  let x_range = $derived([radius + margin, safeWidth - radius - margin]);
  let y_range = $derived([safeHeight - radius - margin, radius + margin]);

  // Base scales (original, unzoomed)
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
      return scaleLinear().domain(scale_extent).range(y_range).nice();
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

  // Zoom state
  let currentTransform: ZoomTransform = $state(zoomIdentity);

  // Zoomed scales
  let x_scale = $derived(
    base_x_scale ? currentTransform.rescaleX(base_x_scale) : undefined,
  );
  let y_scale = $derived(
    base_y_scale ? currentTransform.rescaleY(base_y_scale) : undefined,
  );

  const xGet = (d: Partial<DataEntry>) => x_scale && x_scale(x_accessor(d));
  const yGet = (d: DataEntry) => y_scale && y_scale(y_accessor(d));
  const rGet = (d: DataEntry) =>
    r_accessor && r_scale && r_scale(r_accessor(d));
  const cGet = (d: DataEntry) => {
    const name = c_accessor(d);
    return color_overrides[name] ?? hues[groups.indexOf(name)];
  };

  const [x_formatter, y_formatter] = [timeFormat("%B\n%Y"), format(".2s")];

  let mouse_move: (event: MouseEvent) => void = $state(() => {});
  let mouse_out: () => void = $state(() => {});

  // d3-zoom setup
  let svgElement: SVGSVGElement;
  let isZoomed = $state(false);

  onMount(() => {
    if (!svgElement) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        isZoomed =
          event.transform.k !== 1 ||
          event.transform.x !== 0 ||
          event.transform.y !== 0;
      });

    select(svgElement).call(zoomBehavior);

    // Store for reset
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
    class="flex w-full flex-row items-center"
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
        <clipPath id="chart-area-scatter-{graph_title.replace(/\s/g, '')}">
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

      <g clip-path="url(#chart-area-scatter-{graph_title.replace(/\s/g, '')})">
        <Circles
          {data}
          {xGet}
          {yGet}
          {rGet}
          {cGet}
          {x_scale}
          {y_scale}
          bind:mouse_move
          bind:mouse_out
        />
      </g>
    </svg>

    <Legend {groups} {hues} {color_overrides} {oncolorchange} />

    <Popup
      {data}
      {groups}
      {hues}
      date_accessor={x_accessor}
      group_accessor={c_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>
</div>

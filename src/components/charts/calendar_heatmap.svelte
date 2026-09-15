<script lang="ts">
  import { range, extent } from "d3-array";
  import { scaleLinear, scaleBand } from "d3-scale";

  import { getDay, getWeek, setWeek, setDay, startOfYear, format as formatDate } from "date-fns";
  import Bars from "../draw/bars.svelte";
  import Popup, {
    type TooltipAccessors,
    type TooltipFormatters,
  } from "./popup.svelte";
  import type { DataEntry } from "../../data_wrangling/data_extraction";
  import type { ScaleBand } from "d3";

  interface Props {
    data: Partial<DataEntry>[];
    date_accessor: (d: Partial<DataEntry>) => Date;
    metric_accessor: (d: Partial<DataEntry>) => number;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    graph_title: string;
    highlight_start?: string;
    highlight_end?: string;
    highlight_dates?: Set<string>;
    // Selectable mode
    selectable?: boolean;
    selectedDates?: Set<string>;
    onDateToggle?: (dateStr: string, action: "add" | "remove") => void;
    onDayClick?: (dateStr: string) => void;
    onDayContextMenu?: (dateStr: string, x: number, y: number) => void;
    viewYear?: number;
  }

  let {
    data,
    date_accessor,
    metric_accessor,
    tooltip_accessors,
    tooltip_formatters,
    graph_title,
    highlight_start,
    highlight_end,
    highlight_dates,
    selectable = false,
    selectedDates = new Set(),
    onDateToggle,
    onDayClick,
    onDayContextMenu,
    viewYear = new Date().getFullYear(),
  }: Props = $props();

  let [height, width, margin] = $state([1000, 1200, 10]);
  let safeHeight = $derived.by(() => {
    const minHeight = Math.max(height, 500);
    return minHeight > width ? width : minHeight;
  });
  let safeWidth = $derived(Math.max(width, 500));

  let square_width = $derived((safeWidth - 2 * margin) / 53);
  let square_height = $derived((safeHeight - 2 * margin) / 7);
  let min_square = $derived(Math.min(square_width, square_height));

  let new_width = $derived(min_square * 53);
  let new_height = $derived(min_square * 7);

  // Physical ranges shrink in proport to the maximal circle radius and padding
  let x_range = $derived([margin, new_width - margin]);
  let y_range = $derived([margin, new_height - margin]);

  const xAccessor = (d: Partial<DataEntry>) => {
    return getWeek(date_accessor(d));
  };
  const yAccessor = (d: Partial<DataEntry>) => getDay(date_accessor(d));

  let x_scale: ScaleBand<string> = $derived(
    scaleBand()
      .domain(range(53).map(String))
      .padding(0.01 * (53 / 7))
      .range(x_range),
  );
  let y_scale: ScaleBand<string> = $derived(
    scaleBand().domain(range(7).map(String)).padding(0.1).range(y_range),
  );

  let colorScale = $derived.by(() => {
    const color_extent = extent(data, metric_accessor);
    return color_extent[0] !== undefined && color_extent[1] !== undefined
      ? scaleLinear<string>().domain(color_extent).range(["#818cf8", "#4338ca"])
      : undefined;
  });

  const [xGet, yGet] = [
    (d: Partial<DataEntry>) => x_scale(xAccessor(d).toString()),
    (d: Partial<DataEntry>) => y_scale(yAccessor(d).toString()),
  ];
  const cGet = (d: Partial<DataEntry>) =>
    colorScale && colorScale(metric_accessor(d));

  const dayCode = (day_num: number) => {
    if (day_num === 0) return "S";
    if (day_num === 1) return "M";
    if (day_num === 2) return "T";
    if (day_num === 3) return "W";
    if (day_num === 4) return "T";
    if (day_num === 5) return "F";
    if (day_num === 6) return "S";
  };

  let mouse_move: (event: MouseEvent) => void = $state(() => {});
  let mouse_out: () => void = $state(() => {});

  // ---- Selectable mode ----
  let isDragging = $state(false);
  // dragAction: during a drag we always add (pointer may start on an unselected cell)
  let dragAction: "add" | "remove" = "add";
  let lastDragCell = $state<string | null>(null);

  /** Convert (week, day) grid coords → ISO date string for viewYear */
  function cellToDateStr(week: number, day: number): string | null {
    try {
      // setWeek sets the week number; setDay sets the day-of-week
      const yearBase = startOfYear(new Date(viewYear, 0, 1));
      const withWeek = setWeek(yearBase, week, { weekStartsOn: 0 });
      const withDay = setDay(withWeek, day, { weekStartsOn: 0 });
      // Only include dates that actually belong to viewYear
      if (withDay.getFullYear() !== viewYear) return null;
      return formatDate(withDay, "yyyy-MM-dd");
    } catch {
      return null;
    }
  }

  function handleCellPointerDown(e: PointerEvent, week: number, day: number) {
    if (!selectable || !onDateToggle) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const dateStr = cellToDateStr(week, day);
    if (!dateStr) return;

    isDragging = true;
    // Determine action based on current state of clicked cell
    if (selectedDates.has(dateStr)) {
      dragAction = "remove";
      onDateToggle(dateStr, "remove");
    } else {
      dragAction = "add";
      onDateToggle(dateStr, "add");
    }
    lastDragCell = dateStr;

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
  }

  function handleCellPointerEnter(week: number, day: number) {
    if (!isDragging || !selectable || !onDateToggle) return;
    const dateStr = cellToDateStr(week, day);
    if (!dateStr || dateStr === lastDragCell) return;

    const alreadyInAction =
      dragAction === "add" ? selectedDates.has(dateStr) : !selectedDates.has(dateStr);
    if (!alreadyInAction) {
      onDateToggle(dateStr, dragAction);
    }
    lastDragCell = dateStr;
  }

  function handleWindowPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    // Hit-test the element under the pointer to find which cell it is
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const weekStr = (el as SVGElement).dataset?.week;
    const dayStr = (el as SVGElement).dataset?.day;
    if (weekStr === undefined || dayStr === undefined) return;
    handleCellPointerEnter(Number(weekStr), Number(dayStr));
  }

  function handleWindowPointerUp() {
    isDragging = false;
    lastDragCell = null;
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
  }
</script>

<div class="flex h-full w-full flex-col items-center">
  {#if graph_title}
    <h1 class="mb-6 text-4xl font-semibold text-indigo-400">{graph_title}</h1>
  {/if}

  <figure
    bind:clientHeight={height}
    bind:clientWidth={width}
    class="flex h-full w-full flex-row items-center justify-center"
  >
    <svg
      height={new_height}
      width={new_width}
      class="max-h-[80vh]"
      style="resize: both;"
      viewBox="0 0 {new_width} {new_height}"
      preserveAspectRatio="xMidYMid meet"
    >
      <!-- Background grid cells -->
      {#each range(53) as week_num}
        {#each range(7) as day_num}
          {@const dateStr = cellToDateStr(week_num, day_num)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect
            x={x_scale(week_num.toString())}
            y={y_scale(day_num.toString())}
            height={y_scale.bandwidth()}
            width={x_scale.bandwidth()}
            fill="var(--exs-heatmap-empty, #e2e8f0)"
            fill-opacity="1"
            stroke-width="3"
            style={dateStr ? "cursor: pointer;" : "pointer-events: none;"}
            oncontextmenu={(e) => {
              if (dateStr && onDayContextMenu) {
                e.preventDefault();
                onDayContextMenu(dateStr, e.clientX, e.clientY);
              }
            }}
          />
        {/each}
      {/each}

      {#each range(7) as day_num}
        <text
          y={y_scale(day_num?.toString()) ?? "" + y_scale.bandwidth() / 2}
          height={y_scale.bandwidth()}
          width={x_scale.bandwidth()}
          fill="var(--exs-text-muted, #94a3b8)"
          class="text-[0.6rem]"
          dominant-baseline="middle"
        >
          {dayCode(day_num)}
        </text>
      {/each}

      <Bars
        {data}
        {xGet}
        {yGet}
        hGet={() => y_scale.bandwidth()}
        {cGet}
        bar_width={x_scale.bandwidth()}
        {mouse_move}
        {mouse_out}
        {highlight_start}
        {highlight_end}
        {highlight_dates}
        onclick={(d) => {
          if (!selectable && d.date && onDayClick) {
            onDayClick(d.date);
          }
        }}
        oncontextmenu={(d, e) => {
          if (d.date && onDayContextMenu) {
            e.preventDefault();
            onDayContextMenu(d.date, e.clientX, e.clientY);
          }
        }}
      />

      <!-- Selectable overlay — LAST in SVG so it sits above Bars and captures all pointer events -->
      {#if selectable}
        {#each range(53) as week_num}
          {#each range(7) as day_num}
            {@const dateStr = cellToDateStr(week_num, day_num)}
            {@const isSelected = dateStr !== null && selectedDates.has(dateStr)}
            {#if isSelected}
              <rect
                x={x_scale(week_num.toString())}
                y={y_scale(day_num.toString())}
                height={y_scale.bandwidth()}
                width={x_scale.bandwidth()}
                fill="#2dd4bf"
                fill-opacity="0.5"
                stroke="#2dd4bf"
                stroke-width="1.5"
                rx="2"
                style="pointer-events: none;"
              />
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect
              x={x_scale(week_num.toString())}
              y={y_scale(day_num.toString())}
              height={y_scale.bandwidth()}
              width={x_scale.bandwidth()}
              fill="transparent"
              data-week={week_num}
              data-day={day_num}
              style="cursor: pointer;"
              onpointerdown={(e) => handleCellPointerDown(e, week_num, day_num)}
              oncontextmenu={(e) => {
                if (dateStr && onDayContextMenu) {
                  e.preventDefault();
                  onDayContextMenu(dateStr, e.clientX, e.clientY);
                }
              }}
            />
          {/each}
        {/each}
      {/if}
    </svg>

    <Popup
      {data}
      groups={undefined}
      hues={undefined}
      {date_accessor}
      group_accessor={cGet}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>
</div>

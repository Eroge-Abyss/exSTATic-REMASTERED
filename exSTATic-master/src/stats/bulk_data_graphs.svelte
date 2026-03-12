<script lang="ts">
  import type {
    TooltipAccessors,
    TooltipFormatters,
  } from "../components/charts/popup.svelte";
  import Scatterplot from "../components/charts/scatterplot.svelte";
  import type { DataEntry } from "../data_wrangling/data_extraction";

  interface Props {
    data: DataEntry[];
    name_accessor: (d: Partial<DataEntry>) => string;
    date_accessor: (d: Partial<DataEntry>) => Date;
    chars_read_accessor: (d: Partial<DataEntry>) => number;
    time_read_accessor: (d: DataEntry) => number;
    read_speed_accessor: (d: DataEntry) => number;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
  }

  let {
    data,
    name_accessor,
    date_accessor,
    chars_read_accessor,
    time_read_accessor,
    read_speed_accessor,
    tooltip_accessors,
    tooltip_formatters,
    color_overrides = {},
    oncolorchange,
  }: Props = $props();
</script>

<div class="flex h-full w-full flex-col items-center gap-20">
  <Scatterplot
    {data}
    x_accessor={date_accessor}
    y_accessor={read_speed_accessor}
    r_accessor={chars_read_accessor}
    c_accessor={name_accessor}
    {tooltip_accessors}
    {tooltip_formatters}
    graph_title="Immersion Gains"
    x_label="Date"
    y_label="Reading Speed"
    {color_overrides}
    {oncolorchange}
  />
  <Scatterplot
    {data}
    x_accessor={date_accessor}
    y_accessor={time_read_accessor}
    r_accessor={chars_read_accessor}
    c_accessor={name_accessor}
    {tooltip_accessors}
    {tooltip_formatters}
    graph_title="Immersion Quantity"
    x_label="Date"
    y_label="Time Read"
    {color_overrides}
    {oncolorchange}
  />
</div>

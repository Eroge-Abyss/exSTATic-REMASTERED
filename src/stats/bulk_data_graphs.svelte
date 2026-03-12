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
    onselect?: (group: string | null) => void;
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
    onselect,
  }: Props = $props();

  const tabs = [{ label: "Immersion Gains" }, { label: "Immersion Quantity" }];

  let activeTab = $state(0);

  let activeYAccessor = $derived(
    activeTab === 0 ? read_speed_accessor : time_read_accessor,
  );
  let activeTitle = $derived(tabs[activeTab].label);
  let activeYLabel = $derived(activeTab === 0 ? "Reading Speed" : "Time Read");
</script>

<Scatterplot
  {data}
  x_accessor={date_accessor}
  y_accessor={activeYAccessor}
  r_accessor={chars_read_accessor}
  c_accessor={name_accessor}
  {tooltip_accessors}
  {tooltip_formatters}
  graph_title={activeTitle}
  x_label="Date"
  y_label={activeYLabel}
  {color_overrides}
  {oncolorchange}
  {onselect}
  {tabs}
  {activeTab}
  ontabchange={(i) => (activeTab = i)}
/>

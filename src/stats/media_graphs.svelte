<script lang="ts">
  import BarGraph from "../components/charts/bargraph.svelte";
  import type {
    TooltipAccessors,
    TooltipFormatters,
  } from "../components/charts/popup.svelte";
  import type { DataEntry } from "../data_wrangling/data_extraction";

  interface Props {
    data: {
      name: string;
      time_read: number;
      chars_read: number;
    }[];
    name_accessor: (d: Partial<DataEntry>) => string;
    chars_read_accessor: (d: Partial<DataEntry>) => number;
    time_read_accessor: (d: Partial<DataEntry>) => number;
    read_speed_accessor: (d: Partial<DataEntry>) => number;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
  }

  let {
    data,
    name_accessor,
    chars_read_accessor,
    time_read_accessor,
    read_speed_accessor,
    tooltip_accessors,
    tooltip_formatters,
    color_overrides = {},
    oncolorchange,
  }: Props = $props();

  // Convert time from seconds to hours
  const time_hours_accessor = (d: Partial<DataEntry>) => {
    const seconds = time_read_accessor(d);
    return seconds / 3600;
  };

  // Tabs
  const tabs = [
    { label: "Characters Read" },
    { label: "Time Read" },
    { label: "Reading Speed" },
  ];

  let activeTab = $state(0);

  let activeAccessor = $derived(
    activeTab === 0
      ? chars_read_accessor
      : activeTab === 1
        ? time_hours_accessor
        : read_speed_accessor,
  );

  let activeYLabel = $derived(
    activeTab === 0
      ? "Total Characters"
      : activeTab === 1
        ? "Hours"
        : "Characters / Hour",
  );

  let activeTitle = $derived(tabs[activeTab].label);
</script>

<BarGraph
  {data}
  x_accessor={name_accessor}
  y_accessor={activeAccessor}
  c_accessor={name_accessor}
  {tooltip_accessors}
  {tooltip_formatters}
  graph_title={activeTitle}
  x_label="Title"
  y_label={activeYLabel}
  {tabs}
  {activeTab}
  ontabchange={(i) => (activeTab = i)}
  {color_overrides}
  {oncolorchange}
/>

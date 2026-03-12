<script lang="ts">
  import BulkDataGraphs from "./bulk_data_graphs.svelte";
  import MediaGraphs from "./media_graphs.svelte";
  import CalendarHeatmap from "../components/charts/calendar_heatmap.svelte";

  import { groups, sum, min } from "d3-array";
  import { format } from "d3-format";
  import { parseISO, startOfYear, addYears, subYears, getYear } from "date-fns";
  import {
    getData,
    softDeleteGame,
    restoreGame,
    getDeletedGames,
    permanentDeleteGame,
    renameGame,
    type DataEntry,
  } from "../data_wrangling/data_extraction";
  import type {
    TooltipAccessors,
    TooltipFormatters,
  } from "../components/charts/popup.svelte";
  import * as browser from "webextension-polyfill";

  const SECS_TO_HRS = 60 * 60;

  interface Props {
    data: DataEntry[];
  }

  let { data: initialData }: Props = $props();

  // Reactive data that can be refreshed after delete/restore
  let data = $state(initialData);
  let deletedGames = $state<
    { uuid: string; name: string; type: string; deleted_at: string }[]
  >([]);

  // Load deleted games on init
  async function loadDeletedGames() {
    deletedGames = await getDeletedGames();
  }
  loadDeletedGames();

  async function refreshData() {
    const newData = await getData();
    data =
      newData?.sort(
        (a, b) => parseISO(a.date).valueOf() - parseISO(b.date).valueOf(),
      ) ?? [];
    await loadDeletedGames();
  }

  // ---- Color overrides ----
  let color_overrides: Record<string, string> = $state({});

  async function loadColorOverrides() {
    const stored = await browser.storage.local.get("game_colors");
    color_overrides = stored["game_colors"] ?? {};
  }
  loadColorOverrides();

  async function handleColorChange(gameName: string, color: string) {
    color_overrides[gameName] = color;
    color_overrides = { ...color_overrides };
    await browser.storage.local.set({ game_colors: color_overrides });
  }

  // ---- Game Management ----
  let showGamePanel = $state(false);
  let showDeletedGames = $state(false);
  let confirmDeleteUuid = $state<string | null>(null);
  let confirmPermanentDeleteUuid = $state<string | null>(null);

  // Rename state
  let renamingUuid = $state<string | null>(null);
  let renameValue = $state("");

  function startRename(uuid: string, currentName: string) {
    renamingUuid = uuid;
    renameValue = currentName;
  }

  async function submitRename(uuid: string) {
    if (renameValue.trim()) {
      await renameGame(uuid, renameValue.trim());
      renamingUuid = null;
      renameValue = "";
      await refreshData();
    }
  }

  function cancelRename() {
    renamingUuid = null;
    renameValue = "";
  }

  function toggleGamePanel() {
    showGamePanel = !showGamePanel;
  }

  function toggleFilterPanel() {
    showFilterPanel = !showFilterPanel;
  }

  async function handleSoftDelete(uuid: string) {
    await softDeleteGame(uuid);
    confirmDeleteUuid = null;
    await refreshData();
  }

  async function handleRestore(uuid: string) {
    await restoreGame(uuid);
    await refreshData();
  }

  async function handlePermanentDelete(uuid: string) {
    await permanentDeleteGame(uuid);
    confirmPermanentDeleteUuid = null;
    await loadDeletedGames();
  }

  // ---- Game Filter ----
  let showFilterPanel = $state(false);
  let selectedGames = $state<Set<string>>(new Set());
  let filterInitialized = $state(false);

  let client_groups = $derived(
    groups(data, (d) => JSON.stringify([d.uuid, d.date])),
  );
  let processedData = $derived(
    client_groups.map(([, v]) => ({
      uuid:
        v[0].type === "mokuro"
          ? JSON.parse(v[0].given_identifier)[0]
          : v[0].uuid,
      name:
        v[0].type === "mokuro" && v[0].name === v[0].given_identifier
          ? JSON.parse(v[0].given_identifier)[0]
          : (v[0].name ?? v[0].given_identifier ?? "Unknown"),
      given_identifier: v[0].given_identifier,
      type: v[0].type,
      date: v[0].date,
      time_read: sum(v, (d) => d.time_read),
      chars_read: sum(v, (d) => d.chars_read),
    })),
  );

  // Get all unique game names for the filter
  let allGameNames = $derived(
    Array.from(new Set(processedData.map((d) => d.name ?? "Unknown"))).sort(),
  );

  // Initialize filter with all games selected
  $effect(() => {
    if (!filterInitialized && allGameNames.length > 0) {
      selectedGames = new Set(allGameNames);
      filterInitialized = true;
    }
  });

  // Get unique games with their UUIDs (for the management panel)
  let uniqueGames = $derived(
    Array.from(
      new Map(
        processedData.map((d) => [
          d.name ?? "Unknown",
          { uuid: d.uuid, name: d.name ?? "Unknown", type: d.type },
        ]),
      ).values(),
    ).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
  );

  const currentTime = new Date();
  const currentYearStart = startOfYear(currentTime);
  const earliestStart = $derived(
    min(processedData, (d) => parseISO(d.date)) ?? currentTime,
  );

  let selectedYearStart = $state(currentYearStart);
  let selectedYearEnd = $derived(addYears(selectedYearStart, 1));
  let enableAllTimeView = $derived(selectedYearStart > currentYearStart);
  let displayTime = $derived(
    enableAllTimeView ? "All Time" : getYear(selectedYearStart),
  );

  let mediaType = $state("all");

  let filteredData = $derived(
    (enableAllTimeView
      ? processedData
      : processedData.filter(
          (d) =>
            selectedYearStart <= parseISO(d.date) &&
            parseISO(d.date) <= selectedYearEnd,
        )
    )
      .filter((d) => mediaType === "all" || d.type === mediaType)
      .filter((d) => selectedGames.has(d.name)),
  );

  const nextPeriod = () => (selectedYearStart = addYears(selectedYearStart, 1));
  const previousPeriod = () => {
    if (enableAllTimeView) {
      selectedYearStart = currentYearStart;
    } else if (selectedYearStart > earliestStart) {
      selectedYearStart = subYears(selectedYearStart, 1);
    }
  };

  let uuid_groups = $derived(groups(filteredData, (d) => d.uuid));
  let uuid_summary = $derived(
    uuid_groups.map(([, v]) => ({
      name: v[0].name,
      time_read: sum(v, (d) => d.time_read),
      chars_read: sum(v, (d) => d.chars_read),
    })),
  );

  let date_groups = $derived(groups(filteredData, (d) => d.date));
  let date_summary = $derived(
    date_groups.map(([, v]) => ({
      date: v[0].date,
      time_read: sum(v, (d) => d.time_read),
      chars_read: sum(v, (d) => d.chars_read),
    })),
  );

  const name_accessor = (d: Partial<DataEntry>) => d.name!;
  const date_accessor = (d: Partial<DataEntry>) => parseISO(d.date!);
  const chars_read_accessor = (d: Partial<DataEntry>) => d.chars_read!;
  const time_read_accessor = (d: Partial<DataEntry>) => d.time_read!;
  const read_speed_accessor = (d: Partial<DataEntry>) =>
    (d.chars_read! / d.time_read!) * SECS_TO_HRS;

  const tooltip_accessors: TooltipAccessors = {
    "Chars Read": chars_read_accessor,
    "Time Read": time_read_accessor,
    "Read Speed": read_speed_accessor,
  };

  const tooltip_formatters: TooltipFormatters = {
    "Chars Read": format(",.0f"),
    "Time Read": (t) => {
      let minutes = Math.floor(t.valueOf() / 60);
      let hours = Math.floor(minutes / 60);
      return `${hours}h ${minutes % 60}m`;
    },
    "Read Speed": format(",.0f"),
  };

  function selectAllGames() {
    selectedGames = new Set(allGameNames);
  }

  function deselectAllGames() {
    selectedGames = new Set();
  }

  function toggleGame(name: string) {
    const newSet = new Set(selectedGames);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    selectedGames = newSet;
  }
</script>

<div class="flex flex-col gap-10 px-20">
  <!-- Top Bar -->
  <div
    id="top_bar"
    class="sticky top-0 z-50 flex h-20 items-center justify-between bg-button bg-opacity-80"
  >
    <div class="flex flex-row items-center gap-2">
      <button
        class="material-icons header-text header-icon"
        onclick={previousPeriod}>navigate_before</button
      >
    </div>
    <div class="flex flex-row place-items-center gap-3">
      <p class="header-text">{displayTime}</p>
      <select class="bg-button" bind:value={mediaType}>
        <option value="all">All</option>
        <option value="vn">VN</option>
        <option value="mokuro">Mokuro</option>
        <option value="ttu">TTU</option>
      </select>
    </div>
    <div class="flex flex-row items-center gap-2">
      <button class="toolbar-btn" onclick={toggleFilterPanel}>Filter</button>
      <button class="toolbar-btn" onclick={toggleGamePanel}>Manage</button>
      <button
        class="material-icons header-text header-icon"
        onclick={nextPeriod}>navigate_next</button
      >
    </div>
  </div>

  <!-- Game Filter Panel -->
  {#if showFilterPanel}
    <div class="panel">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-indigo-400">Filter Games</h2>
        <div class="flex gap-2">
          <button class="btn-sm btn-primary" onclick={selectAllGames}>
            Select All
          </button>
          <button class="btn-sm btn-secondary" onclick={deselectAllGames}>
            Deselect All
          </button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each allGameNames as gameName}
          <button
            class="pill {selectedGames.has(gameName)
              ? 'pill-active'
              : 'pill-inactive'}"
            onclick={() => toggleGame(gameName)}
          >
            {#if color_overrides[gameName]}
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background-color: {color_overrides[gameName]};"
              ></span>
            {/if}
            {gameName}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Game Management Panel -->
  {#if showGamePanel}
    <div class="panel">
      <h2 class="mb-3 text-lg font-semibold text-indigo-400">Manage Games</h2>

      <!-- Active Games -->
      <div class="space-y-1">
        {#each uniqueGames as game}
          <div class="game-row">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              {#if color_overrides[game.name]}
                <span
                  class="inline-block h-3 w-3 shrink-0 rounded-full"
                  style="background-color: {color_overrides[game.name]};"
                ></span>
              {/if}

              {#if renamingUuid === game.uuid}
                <input
                  type="text"
                  bind:value={renameValue}
                  class="rename-input"
                  onkeydown={(e) => {
                    if (e.key === "Enter") submitRename(game.uuid);
                    if (e.key === "Escape") cancelRename();
                  }}
                />
                <button
                  class="btn-sm btn-primary"
                  onclick={() => submitRename(game.uuid)}
                >
                  Save
                </button>
                <button class="btn-sm btn-secondary" onclick={cancelRename}>
                  Cancel
                </button>
              {:else}
                <span class="text-sm text-gray-200 truncate">{game.name}</span>
                <span class="type-badge">{game.type}</span>
              {/if}
            </div>

            {#if renamingUuid !== game.uuid}
              <div class="flex gap-1 shrink-0">
                <button
                  class="btn-sm btn-secondary"
                  title="Rename"
                  onclick={() => startRename(game.uuid, game.name)}
                >
                  ✏️
                </button>

                {#if confirmDeleteUuid === game.uuid}
                  <span class="text-xs text-red-400 self-center mr-1"
                    >Delete?</span
                  >
                  <button
                    class="btn-sm btn-danger"
                    onclick={() => handleSoftDelete(game.uuid)}
                  >
                    Yes
                  </button>
                  <button
                    class="btn-sm btn-secondary"
                    onclick={() => (confirmDeleteUuid = null)}
                  >
                    No
                  </button>
                {:else}
                  <button
                    class="btn-sm btn-danger-muted"
                    title="Delete"
                    onclick={() => (confirmDeleteUuid = game.uuid)}
                  >
                    🗑️
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Deleted Games -->
      {#if deletedGames.length > 0}
        <button
          class="mt-4 text-sm text-gray-400 hover:text-gray-200"
          onclick={() => (showDeletedGames = !showDeletedGames)}
        >
          {showDeletedGames ? "▾" : "▸"} Deleted Games ({deletedGames.length})
        </button>

        {#if showDeletedGames}
          <div class="mt-2 space-y-1">
            {#each deletedGames as game}
              <div class="game-row game-row-deleted">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-sm text-gray-400 line-through truncate"
                    >{game.name}</span
                  >
                  <span class="type-badge">{game.type}</span>
                  <span class="text-[10px] text-gray-600">
                    {new Date(game.deleted_at).toLocaleDateString()}
                  </span>
                </div>
                <div class="flex gap-1 shrink-0">
                  <button
                    class="btn-sm btn-restore"
                    onclick={() => handleRestore(game.uuid)}
                  >
                    ↩️ Restore
                  </button>
                  {#if confirmPermanentDeleteUuid === game.uuid}
                    <button
                      class="btn-sm btn-danger"
                      onclick={() => handlePermanentDelete(game.uuid)}
                    >
                      Confirm
                    </button>
                    <button
                      class="btn-sm btn-secondary"
                      onclick={() => (confirmPermanentDeleteUuid = null)}
                    >
                      Cancel
                    </button>
                  {:else}
                    <button
                      class="btn-sm btn-danger-muted"
                      title="Permanently delete"
                      onclick={() => (confirmPermanentDeleteUuid = game.uuid)}
                    >
                      ❌
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if filteredData.length > 0}
    {#if !enableAllTimeView}
      <CalendarHeatmap
        data={date_summary}
        {date_accessor}
        metric_accessor={time_read_accessor}
        graph_title="Streak"
        {tooltip_accessors}
        {tooltip_formatters}
      />
    {/if}

    <BulkDataGraphs
      data={filteredData}
      {name_accessor}
      {date_accessor}
      {chars_read_accessor}
      {time_read_accessor}
      {read_speed_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      {color_overrides}
      oncolorchange={handleColorChange}
    />
    <MediaGraphs
      data={uuid_summary}
      {name_accessor}
      {chars_read_accessor}
      {time_read_accessor}
      {read_speed_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      {color_overrides}
      oncolorchange={handleColorChange}
    />
  {:else}
    <div class="flex h-64 items-center justify-center">
      <p class="text-lg text-gray-500">
        No data to display{allGameNames.length > 0
          ? " — try adjusting filters"
          : ""}
      </p>
    </div>
  {/if}
</div>

<style global lang="postcss">
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  body {
    @apply bg-slate-800;
  }

  .header-text {
    @apply inline-flex items-center text-4xl;
  }

  .header-icon {
    @apply h-full;
  }
  .header-icon:hover {
    @apply bg-hover text-icon;
  }

  /* Toolbar buttons */
  .toolbar-btn {
    @apply rounded px-3 py-1 text-sm bg-slate-700 text-gray-300 cursor-pointer;
  }
  .toolbar-btn:hover {
    @apply bg-indigo-500 text-white;
  }
  .toolbar-btn-active {
    @apply bg-indigo-600 text-white;
  }

  /* Panels */
  .panel {
    @apply rounded-lg bg-slate-900 p-4;
  }

  /* Small buttons */
  .btn-sm {
    @apply rounded px-2 py-1 text-xs cursor-pointer;
  }
  .btn-primary {
    @apply bg-indigo-600 text-white;
  }
  .btn-primary:hover {
    @apply bg-indigo-500;
  }
  .btn-secondary {
    @apply bg-slate-700 text-gray-300;
  }
  .btn-secondary:hover {
    @apply bg-slate-600;
  }
  .btn-danger {
    @apply bg-red-600 text-white;
  }
  .btn-danger:hover {
    @apply bg-red-500;
  }
  .btn-danger-muted {
    @apply bg-red-900 text-red-300;
  }
  .btn-danger-muted:hover {
    @apply bg-red-800;
  }
  .btn-restore {
    @apply bg-green-900 text-green-300;
  }
  .btn-restore:hover {
    @apply bg-green-800;
  }

  /* Pills for filter */
  .pill {
    @apply flex items-center gap-1.5 rounded-full px-3 py-1 text-sm cursor-pointer;
  }
  .pill-active {
    @apply bg-indigo-600 text-white;
  }
  .pill-inactive {
    @apply bg-slate-700 text-gray-400;
  }

  /* Game rows */
  .game-row {
    @apply flex items-center justify-between rounded bg-slate-800 px-3 py-2;
  }
  .game-row-deleted {
    @apply bg-opacity-50 border border-slate-700;
  }

  /* Type badge */
  .type-badge {
    @apply rounded bg-slate-700 px-1.5 py-0.5 uppercase;
    font-size: 10px;
    color: #9ca3af;
  }

  /* Rename input */
  .rename-input {
    @apply rounded bg-slate-700 px-2 py-1 text-sm text-white border border-indigo-500 outline-none flex-1;
  }
</style>

<script lang="ts">
  import BulkDataGraphs from "./bulk_data_graphs.svelte";
  import MediaGraphs from "./media_graphs.svelte";
  import CalendarHeatmap from "../components/charts/calendar_heatmap.svelte";
  import ContextMenu from "../components/interface/context_menu.svelte";
  import DateRangePicker from "../components/interface/date_range_picker.svelte";
  import { fade, slide } from "svelte/transition";
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";

  import { group, groups, sum, min, max } from "d3-array";
  import { format } from "d3-format";
  import { line, area, curveMonotoneX } from "d3-shape";
  import { scalePoint, scaleLinear } from "d3-scale";
  import {
    differenceInDays,
    isSameMonth,
    isSameYear,
    isSameWeek,
    subMonths,
    addMonths,
    subYears,
    addYears,
    subWeeks,
    addWeeks,
    subDays,
    addDays,
    format as formatDate,
    parseISO,
    startOfYear,
    endOfYear,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    eachDayOfInterval,
    eachWeekOfInterval,
    eachMonthOfInterval,
    getYear,
  } from "date-fns";
  import {
    getData,
    getAllInstances,
    softDeleteGame,
    restoreGame,
    getDeletedGames,
    permanentDeleteGame,
    renameGame,
    getDuplicateGroups,
    mergeGames,
    undoMerge,
    getMergeHistory,
    upsertManualStat,
    restoreManualStats,
    createManualTitle,
    repairDateStats,
    type DataEntry,
    type StatSnapshot,
    type MergeSnapshot,
  } from "../data_wrangling/data_extraction";
  import type {
    TooltipAccessors,
    TooltipFormatters,
  } from "../components/charts/popup.svelte";
  import * as browser from "webextension-polyfill";
  import { applyTheme } from "../themes/apply_theme";

  applyTheme();

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

  // Refresh data in real time when storage changes
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  browser.storage.onChanged.addListener(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const fresh = await getData();
      if (fresh) {
        data = fresh.sort(
          (a, b) => parseISO(a["date"]).valueOf() - parseISO(b["date"]).valueOf()
        );
      }
    }, 300);
  });

  // Load deleted games on init
  async function loadDeletedGames() {
    deletedGames = await getDeletedGames();
  }
  loadDeletedGames();

  // All tracked instances (including those with no stats yet)
  let allInstances = $state<{ uuid: string; name: string; type: string }[]>([]);
  async function loadAllInstances() {
    allInstances = await getAllInstances();
  }
  loadAllInstances();

  // Duplicate detection
  let duplicateGroups = $state<{ name: string; uuids: string[] }[]>([]);
  let showDuplicates = $state(false);
  let mergingGroup = $state<string | null>(null);

  async function loadDuplicates() {
    duplicateGroups = await getDuplicateGroups();
  }
  loadDuplicates();

  async function handleMerge(group: { name: string; uuids: string[] }) {
    const confirmed = confirm(
      `Merge all ${group.uuids.length} entries for "${group.name}" into one?\nThis combines stats and lines. Use the Merge History panel to undo if needed.`
    );
    if (!confirmed) return;
    mergingGroup = group.name;

    // Smart primary selection: inspect candidates to keep the richest/active game as primary
    const candidateScores: { uuid: string; score: number }[] = [];
    for (const uuid of group.uuids) {
      const detailsRaw = await browser.storage.local.get(uuid);
      const details = detailsRaw[uuid] ?? {};
      let score = 0;
      // Prefer tracked media types (vn, mokuro, ttu) over manual entries
      if (details.type && details.type !== "manual") score += 100000;
      // Prefer games with recorded lines
      if (details.last_line_added && details.last_line_added > 0) {
        score += details.last_line_added;
      }
      // Prefer games with more tracked characters in data
      const charsForUuid = sum(data.filter((d) => d.uuid === uuid), (d) => d.chars_read || 0);
      score += charsForUuid;

      candidateScores.push({ uuid, score });
    }

    candidateScores.sort((a, b) => b.score - a.score);
    const sortedUuids = candidateScores.map((c) => c.uuid);
    const [primary, ...rest] = sortedUuids;

    for (const secondary of rest) {
      await mergeGames(primary, secondary);
    }
    mergingGroup = null;
    await refreshData();
    await loadDuplicates();
    await loadMergeHistory();
  }

  // ---- Merge History / Undo ----
  let mergeHistory = $state<MergeSnapshot[]>([]);
  let undoingMerge = $state<string | null>(null);

  async function loadMergeHistory() {
    mergeHistory = await getMergeHistory();
  }
  loadMergeHistory();

  async function handleUndoMerge(snapshot: MergeSnapshot) {
    const confirmed = confirm(
      `Undo merge of "${snapshot.secondaryName}" into "${snapshot.primaryName}"?\nThis will restore both games to their pre-merge state.`
    );
    if (!confirmed) return;
    undoingMerge = snapshot.timestamp;
    await undoMerge(snapshot);
    undoingMerge = null;
    await refreshData();
    await loadDuplicates();
    await loadMergeHistory();
  }

  // ---- Period Tab Definitions & State ----
  const PERIODS = ["Week", "Month", "Year", "All Time"] as const;
  type PeriodType = (typeof PERIODS)[number] | "Custom";
  let selectedPeriod = $state<PeriodType>("Week");
  let periodOffset = $state(0);
  let savedDefaultPeriod = $state<PeriodType | null>(null);

  let customPeriodStart = $state<string | null>(null);
  let customPeriodEnd = $state<string | null>(null);
  let showCustomDatePicker = $state(false);
  let selectedHeatmapDay = $state<string | null>(null);

  function applyCustomPeriod(start: string, end: string) {
    const [sortedStart, sortedEnd] = start <= end ? [start, end] : [end, start];
    customPeriodStart = sortedStart;
    customPeriodEnd = sortedEnd;
    selectedPeriod = "Custom";
    customHighlightStart = sortedStart;
    customHighlightEnd = sortedEnd;

    if (savedDefaultPeriod === "Custom") {
      browser.storage.local.set({
        custom_period_start: sortedStart,
        custom_period_end: sortedEnd,
      });
    }

    if (!enableAllTimeView) {
      const startYear = parseISO(sortedStart).getFullYear();
      if (getYear(selectedYearStart) !== startYear) {
        selectedYearStart = new Date(startYear, 0, 1);
      }
    }
    showCustomDatePicker = false;
  }

  let previousPeriodBeforeStreak = $state<PeriodType | null>(null);

  function toggleStreak(start: string, end: string) {
    if (
      selectedPeriod === "Custom" &&
      customPeriodStart === start &&
      customPeriodEnd === end
    ) {
      const fallback =
        previousPeriodBeforeStreak && previousPeriodBeforeStreak !== "Custom"
          ? previousPeriodBeforeStreak
          : savedDefaultPeriod && savedDefaultPeriod !== "Custom"
            ? savedDefaultPeriod
            : "Week";
      selectedPeriod = fallback;
      customHighlightStart = undefined;
      customHighlightEnd = undefined;
      if (savedDefaultPeriod !== "Custom") {
        customPeriodStart = null;
        customPeriodEnd = null;
      }
      previousPeriodBeforeStreak = null;
    } else {
      if (selectedPeriod !== "Custom") {
        previousPeriodBeforeStreak = selectedPeriod;
      }
      applyCustomPeriod(start, end);
    }
  }

  async function loadDefaultPeriod() {
    const res = await browser.storage.local.get([
      "default_period",
      "custom_period_start",
      "custom_period_end",
    ]);
    if (res.default_period) {
      if (res.default_period === "Custom") {
        savedDefaultPeriod = "Custom";
        if (res.custom_period_start && res.custom_period_end) {
          applyCustomPeriod(res.custom_period_start, res.custom_period_end);
        } else {
          selectedPeriod = "Custom";
        }
      } else if (
        (PERIODS as readonly string[]).includes(res.default_period)
      ) {
        savedDefaultPeriod = res.default_period as PeriodType;
        selectPeriod(res.default_period as PeriodType);
      }
    }
  }
  loadDefaultPeriod();

  /** Switch the Reading Summary period. Independent of the header year picker. */
  function selectPeriod(p: PeriodType) {
    selectedPeriod = p;
    if (p !== "Custom") {
      showCustomDatePicker = false;
    }
  }

  // ---- Period Context Menu ----
  let periodMenu = $state<{
    show: boolean;
    x: number;
    y: number;
    period: PeriodType;
  }>({
    show: false,
    x: 0,
    y: 0,
    period: "Week",
  });

  function handlePeriodContextMenu(p: PeriodType, e: MouseEvent) {
    e.preventDefault();
    closeBarMenu();
    closeDayMenu();

    periodMenu = {
      show: true,
      x: e.clientX,
      y: e.clientY,
      period: p,
    };
  }

  function closePeriodMenu() {
    if (periodMenu.show) periodMenu.show = false;
  }

  async function saveDefaultPeriod(p: PeriodType) {
    if (savedDefaultPeriod === p) {
      savedDefaultPeriod = null;
      await browser.storage.local.remove([
        "default_period",
        "custom_period_start",
        "custom_period_end",
      ]);
    } else {
      savedDefaultPeriod = p;
      selectPeriod(p);
      const toSave: Record<string, any> = { default_period: p };
      if (p === "Custom" && customPeriodStart && customPeriodEnd) {
        toSave.custom_period_start = customPeriodStart;
        toSave.custom_period_end = customPeriodEnd;
      }
      await browser.storage.local.set(toSave);
    }
    closePeriodMenu();
  }

  // ---- Bar Context Menu ----
  let barMenu = $state({ show: false, x: 0, y: 0, gameName: "" });

  function handleBarContextMenu(name: string, x: number, y: number) {
    closeDayMenu();
    closePeriodMenu();
    barMenu = { show: true, x, y, gameName: name };
  }

  function closeBarMenu() {
    if (barMenu.show) barMenu.show = false;
  }

  // ---- Heatmap Day Context Menu ----
  let dayMenu = $state<{
    show: boolean;
    x: number;
    y: number;
    dateStr: string;
    games: { uuid: string; name: string; type?: string }[];
  }>({
    show: false,
    x: 0,
    y: 0,
    dateStr: "",
    games: [],
  });

  function handleDayContextMenu(dateStr: string, x: number, y: number) {
    closeBarMenu();
    closePeriodMenu();

    // Find all games that have sessions on this date
    const playedGames = uniqueGames.filter((g) =>
      data.some((d) => d.date === dateStr && (d.uuid === g.uuid || d.name === g.name))
    );

    // If there are games played on this date, prioritize them; otherwise fallback to all active uniqueGames
    const games = playedGames.length > 0 ? playedGames : [...uniqueGames];

    // Clamp coordinates to prevent menu running off screen
    const clampedX = Math.min(x, typeof window !== "undefined" ? window.innerWidth - 240 : x);
    const clampedY = Math.min(y, typeof window !== "undefined" ? window.innerHeight - 300 : y);

    dayMenu = {
      show: true,
      x: Math.max(10, clampedX),
      y: Math.max(10, clampedY),
      dateStr,
      games,
    };
  }

  function closeDayMenu() {
    if (dayMenu.show) dayMenu.show = false;
  }

  function closeAllMenus() {
    closeBarMenu();
    closeDayMenu();
    closePeriodMenu();
  }

  function handleAddCustomSession(dateStr: string, game: { uuid: string; name: string }) {
    closeDayMenu();
    showGamePanel = true;
    startEditStats(game);
    editSelectedDates = new Set([dateStr]);

    // If there is an existing stat for this game on this date, pre-fill it
    const existing = data.find(
      (d) => d.date === dateStr && (d.uuid === game.uuid || d.name === game.name)
    );
    if (existing) {
      editChars = existing.chars_read ?? 0;
      const totalSecs = existing.time_read ?? 0;
      editHours = Math.floor(totalSecs / 3600);
      editMins = Math.floor((totalSecs % 3600) / 60);
      editSecs = Math.round(totalSecs % 60);
    }

    setTimeout(() => {
      const el =
        document.getElementById(`game-editor-${game.uuid}`) ||
        document.getElementById("manage_panel");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  async function handleRecalculateSession(dateStr: string, game: { uuid: string; name: string }) {
    closeDayMenu();
    showGamePanel = true;
    startEditStats(game);
    editSelectedDates = new Set([dateStr]);

    setTimeout(() => {
      const el =
        document.getElementById(`game-editor-${game.uuid}`) ||
        document.getElementById("manage_panel");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    await recalculateFromLines();
  }

  async function refreshData() {
    const newData = await getData();
    data =
      newData?.sort(
        (a, b) => parseISO(a.date).valueOf() - parseISO(b.date).valueOf(),
      ) ?? [];
    await loadDeletedGames();
    await loadAllInstances();
  }

  // ---- Global Settings ----
  let disableAnimations = $state(false);

  async function loadAnimationsSetting() {
    const res = await browser.storage.local.get("disable_animations");
    disableAnimations = !!res.disable_animations;
  }
  loadAnimationsSetting();

  $effect(() => {
    if (typeof window !== "undefined") {
      if (disableAnimations) {
        document.body.classList.add("no-animations");
      } else {
        document.body.classList.remove("no-animations");
      }
    }
  });

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

  // ---- Manual Stat Edit ----
  let editingGame = $state<{ uuid: string; name: string } | null>(null);
  let editChars = $state(0);
  let editLines = $state<number | undefined>(undefined);
  let editHours = $state(0);
  let editMins = $state(0);
  let editSecs = $state(0);
  let editSelectedDates = $state(new Set<string>());
  let editSaving = $state(false);
  let editHistory = $state<StatSnapshot[][]>([]);
  let recalculating = $state(false);
  let recalcMsg = $state("");

  function startEditStats(game: { uuid: string; name: string }) {
    editingGame = game;
    editChars = 0;
    editLines = undefined;
    editHours = 0;
    editMins = 0;
    editSecs = 0;
    editSelectedDates = new Set();
    editHistory = [];
    recalcMsg = "";
  }

  function handleDateToggle(dateStr: string, action: "add" | "remove") {
    const next = new Set(editSelectedDates);
    if (action === "add") next.add(dateStr);
    else next.delete(dateStr);
    editSelectedDates = next;
  }

  async function applyStats() {
    if (!editingGame || editSelectedDates.size === 0) return;
    editSaving = true;
    const time_read = editHours * 3600 + editMins * 60 + editSecs;
    const snapshots: StatSnapshot[] = [];
    for (const date of editSelectedDates) {
      const snap = await upsertManualStat(editingGame.uuid, date, editChars, time_read, editLines);
      snapshots.push(snap);
    }
    editLines = undefined; // clear after apply so next save doesn't re-use stale lines_read
    recalcMsg = "";
    editHistory = [...editHistory, snapshots];
    editSaving = false;
    await refreshData();
  }

  async function undoLastApply() {
    if (!editingGame || editHistory.length === 0) return;
    const snapshots = editHistory[editHistory.length - 1];
    editHistory = editHistory.slice(0, -1);
    await restoreManualStats(editingGame.uuid, snapshots);
    await refreshData();
  }

  function finishEdit() {
    editingGame = null;
    editHistory = [];
    editSelectedDates = new Set();
    editLines = undefined;
    recalcMsg = "";
  }

  async function recalculateFromLines() {
    if (!editingGame || editSelectedDates.size !== 1) return;
    const date = [...editSelectedDates][0];
    recalculating = true;
    recalcMsg = "";
    try {
      const result = await repairDateStats(editingGame.uuid, date);
      // Pre-fill chars from stored lines; time fields from the existing stored value.
      editChars = result.chars_read;
      editLines = result.lines_read;
      const totalSecs = result.time_read;
      editHours = Math.floor(totalSecs / 3600);
      editMins = Math.floor((totalSecs % 3600) / 60);
      editSecs = Math.round(totalSecs % 60);
      recalcMsg = result.skippedLines > 0
        ? `${result.chars_read} chars from stored lines (${result.skippedLines} line${result.skippedLines !== 1 ? "s" : ""} skipped — no timestamp)`
        : `${result.chars_read} chars from stored lines`;
    } finally {
      recalculating = false;
    }
  }

  // ---- New Title Creation ----
  let newTitleName = $state("");
  let newTitleType = $state("vn");
  let creatingTitle = $state(false);

  async function createTitle() {
    if (!newTitleName.trim()) return;
    creatingTitle = true;
    const inst = await createManualTitle(newTitleName.trim(), newTitleType);
    await loadAllInstances();
    newTitleName = "";
    creatingTitle = false;
    // Immediately open the editor for the new title
    startEditStats(inst);
  }

  // ---- Game Filter ----
  let showFilterPanel = $state(false);
  let selectedGames = $state<Set<string>>(new Set());
  /** Tracks every game name ever shown in the filter — so deselected games
   *  aren't re-added on the next storage.onChanged refresh cycle. */
  let knownGameNames = $state<Set<string>>(new Set());
  let filterInitialized = $state(false);

  let processedData = $derived(
    Array.from(
      group(
        data,
        (d) => {
          let nameStr =
            d.type === "mokuro" && d.name === d.given_identifier
              ? JSON.parse(d.given_identifier)[0]
              : (d.name ?? d.given_identifier ?? "Unknown");
          return String(nameStr).trim();
        },
        (d) => d.date,
      ).entries(),
    ).flatMap(([nameKey, dateMap]) => {
      // nameKey is the resolved name we grouped by
      return Array.from(dateMap.values()).map((v) => ({
        uuid: v[0].uuid, // Keep the first UUID just for reference
        name: nameKey.trim(),
        given_identifier: v[0].given_identifier,
        type: v[0].type,
        date: v[0].date,
        time_read: sum(v, (d) => d.time_read),
        chars_read: sum(v, (d) => d.chars_read),
      }));
    }),
  );

  // Get all unique game names for the filter

  // Initialize filter with all games selected; also auto-add any new names that
  // appear after a stat write so fresh entries show up immediately.
  $effect(() => {
    if (!filterInitialized && allGameNames.length > 0) {
      selectedGames = new Set(allGameNames);
      knownGameNames = new Set(allGameNames);
      filterInitialized = true;
    } else if (filterInitialized) {
      // Only auto-add games that have never appeared in the filter before.
      // Games that are in knownGameNames but not selectedGames were
      // intentionally deselected by the user — leave them alone.
      const brandNewNames = allGameNames.filter((n) => !knownGameNames.has(n));
      if (brandNewNames.length > 0) {
        selectedGames = new Set([...selectedGames, ...brandNewNames]);
        knownGameNames = new Set([...knownGameNames, ...brandNewNames]);
      }
    }
  });

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

  /** Year + media-type filtered data, without the selectedGames filter.
   *  Used to derive allGameNames so the filter panel only shows games
   *  that have data in the currently selected year / All Time view. */
  let yearMediaData = $derived(
    (enableAllTimeView
      ? processedData
      : processedData.filter(
          (d) =>
            selectedYearStart <= parseISO(d.date) &&
            parseISO(d.date) <= selectedYearEnd,
        )
    ).filter((d) => mediaType === "all" || d.type === mediaType),
  );

  // Get unique games with their UUIDs (for the management panel).
  // Only shows entries in the current year, or all of them if it's All Time.
  let uniqueGames = $derived(
    Array.from(
      new Map(
        yearMediaData.map((d) => [
          (d.name ?? "Unknown").trim(),
          { uuid: d.uuid, name: (d.name ?? "Unknown").trim(), type: d.type },
        ]),
      ).values(),
    ).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
  );

  // Get all unique game names visible in the current year/All Time + media filter.
  let allGameNames = $derived(
    Array.from(new Set(yearMediaData.map((d) => d.name))).sort(),
  );

  let filteredData = $derived(
    yearMediaData.filter((d) => selectedGames.has(d.name)),
  );

  function syncReadingSummaryToGlobalYear(newYear: number) {
    let targetDate = new Date(newYear, 11, 31);
    const datesInYear = processedData
      .filter((d) => mediaType === "all" || d.type === mediaType)
      .filter((d) => selectedGames.has(d.name))
      .filter((d) => getYear(parseISO(d.date)) === newYear);

    if (datesInYear.length > 0) {
      const maxTime = max(datesInYear, (d) => parseISO(d.date).getTime());
      if (maxTime) targetDate = new Date(maxTime);
    }

    // Recompute baseDate directly to ensure accurate offset
    let bDate = new Date();
    const allValidDates = processedData
      .filter((d) => mediaType === "all" || d.type === mediaType)
      .filter((d) => selectedGames.has(d.name));
    if (allValidDates.length > 0) {
      const bMaxTime = max(allValidDates, (d) => parseISO(d.date).getTime());
      if (bMaxTime) bDate = new Date(bMaxTime);
    }

    if (selectedPeriod === "Week") {
      periodOffset = Math.floor(differenceInDays(targetDate, bDate) / 7);
    } else if (selectedPeriod === "Month") {
      periodOffset =
        (newYear - bDate.getFullYear()) * 12 +
        (targetDate.getMonth() - bDate.getMonth());
    } else if (selectedPeriod === "Year") {
      periodOffset = newYear - bDate.getFullYear();
    }
  }

  const nextPeriod = () => {
    selectedYearStart = addYears(selectedYearStart, 1);
    if (selectedYearStart > currentYearStart) {
      // Entered All Time view — reset period offset so Reading Summary
      // shows the current period rather than a future one.
      periodOffset = 0;
    } else {
      syncReadingSummaryToGlobalYear(getYear(selectedYearStart));
    }
  };
  const previousPeriod = () => {
    if (enableAllTimeView) {
      selectedYearStart = currentYearStart;
      syncReadingSummaryToGlobalYear(getYear(selectedYearStart));
    } else if (selectedYearStart > earliestStart) {
      selectedYearStart = subYears(selectedYearStart, 1);
      syncReadingSummaryToGlobalYear(getYear(selectedYearStart));
    }
  };

  let uuid_groups = $derived(groups(filteredData, (d) => d.name));
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
      titles: Array.from(new Set(v.map((d) => d.name))).join(", "),
    })),
  );

  let baseData = $derived(
    processedData
      .filter((d) => mediaType === "all" || d.type === mediaType)
      .filter((d) => selectedGames.has(d.name)),
  );

  let legendSelectedGroup = $state<string | null>(null);

  let statsBaseData = $derived(
    baseData.filter(
      (d) => !legendSelectedGroup || d.name === legendSelectedGroup,
    ),
  );
  let statsFilteredData = $derived(
    filteredData.filter(
      (d) => !legendSelectedGroup || d.name === legendSelectedGroup,
    ),
  );

  let legendHighlightDates = $derived(
    legendSelectedGroup
      ? new Set(statsFilteredData.map((d) => d.date))
      : undefined,
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

  const heatmap_tooltip_accessors: TooltipAccessors = {
    ...tooltip_accessors,
    Titles: (d: any) => d.titles,
  };

  const heatmap_tooltip_formatters: TooltipFormatters = {
    ...tooltip_formatters,
    Titles: (t: any) => t,
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

  // ---- Stat Card Calculations ----
  const fmtChars = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return `${Math.round(v)}`;
  };
  const fmtTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  let statCards = $derived.by(() => {
    const totalChars = sum(statsFilteredData, (d) => d.chars_read);
    const totalSecs = sum(statsFilteredData, (d) => d.time_read);
    const activeDays = new Set(statsFilteredData.map((d) => d.date)).size;
    const totalHrs = totalSecs / 3600;
    const avgSpeed =
      totalSecs > 0 ? Math.round((totalChars / totalSecs) * 3600) : 0;

    // Span in calendar days (at least 1)
    const dates = statsFilteredData.map((d) => parseISO(d.date));
    const earliest =
      dates.length > 0
        ? new Date(Math.min(...dates.map((d) => d.getTime())))
        : new Date();
    const latest =
      dates.length > 0
        ? new Date(Math.max(...dates.map((d) => d.getTime())))
        : new Date();
    const spanDays = Math.max(1, differenceInDays(latest, earliest) + 1);

    const charsPerDay =
      activeDays > 0 ? Math.round(totalChars / activeDays) : 0;
    const timePerDay = activeDays > 0 ? totalSecs / activeDays : 0;

    const activeMonths = new Set(
      statsFilteredData.map((d) => d.date.substring(0, 7)),
    ).size;
    const charsPerMonth =
      activeMonths > 0 ? Math.round(totalChars / activeMonths) : 0;
    const timePerMonth = activeMonths > 0 ? totalSecs / activeMonths : 0;

    const activeYears = new Set(
      statsFilteredData.map((d) => d.date.substring(0, 4)),
    ).size;
    const charsPerYear =
      activeYears > 0 ? Math.round(totalChars / activeYears) : 0;
    const timePerYear = activeYears > 0 ? totalSecs / activeYears : 0;

    // Session averages (each unique date = 1 session)
    const sessionCount = activeDays;
    const avgCharsPerSession =
      sessionCount > 0 ? Math.round(totalChars / sessionCount) : 0;
    const avgTimePerSession = sessionCount > 0 ? totalSecs / sessionCount : 0;

    // Streaks
    let currentStreak = 0;
    let currentStreakStart: string | null = null;
    let currentStreakEnd: string | null = null;
    let bestStreak = 0;
    let bestStreakStart: string | null = null;
    let bestStreakEnd: string | null = null;

    const uniqueDaySet = new Set(statsFilteredData.map((d) => d.date));
    if (uniqueDaySet.size > 0) {
      const sortedAsc = Array.from(uniqueDaySet)
        .map((d) => ({ time: parseISO(d).getTime(), dateStr: d }))
        .sort((a, b) => a.time - b.time);

      let run = 1;
      let runStart = sortedAsc[0].dateStr;
      let maxRun = 1;
      let maxRunStart = sortedAsc[0].dateStr;
      let maxRunEnd = sortedAsc[0].dateStr;

      for (let i = 1; i < sortedAsc.length; i++) {
        const diff = (sortedAsc[i].time - sortedAsc[i - 1].time) / 86400000;
        if (diff <= 1.1) {
          run++;
        } else {
          run = 1;
          runStart = sortedAsc[i].dateStr;
        }
        if (run > maxRun) {
          maxRun = run;
          maxRunStart = runStart;
          maxRunEnd = sortedAsc[i].dateStr;
        }
      }
      bestStreak = maxRun;
      bestStreakStart = maxRunStart;
      bestStreakEnd = maxRunEnd;

      // current streak from the end
      const todayMs = new Date().setHours(0, 0, 0, 0);
      const lastDay = sortedAsc[sortedAsc.length - 1];
      if ((todayMs - lastDay.time) / 86400000 <= 1) {
        currentStreak = 1;
        let prev = lastDay;
        currentStreakStart = lastDay.dateStr;
        currentStreakEnd = lastDay.dateStr;
        for (let i = sortedAsc.length - 2; i >= 0; i--) {
          if ((prev.time - sortedAsc[i].time) / 86400000 <= 1.1) {
            currentStreak++;
            prev = sortedAsc[i];
            currentStreakStart = sortedAsc[i].dateStr;
          } else break;
        }
      }
    }

    return {
      totalChars,
      totalHrs,
      avgSpeed,
      activeDays,
      totalSecs,
      charsPerDay,
      timePerDay,
      charsPerMonth,
      timePerMonth,
      charsPerYear,
      timePerYear,
      avgCharsPerSession,
      avgTimePerSession,
      currentStreak,
      currentStreakStart,
      currentStreakEnd,
      bestStreak,
      bestStreakStart,
      bestStreakEnd,
      titlesRead: new Set(statsFilteredData.map((d) => d.name)).size,
    };
  });

  let charAvgIndex = $state(0);
  let timeAvgIndex = $state(0);

  let customHighlightStart = $state<string | undefined>(undefined);
  let customHighlightEnd = $state<string | undefined>(undefined);

  function toggleHighlight(date: string | undefined) {
    if (customHighlightStart === date && customHighlightEnd === date) {
      customHighlightStart = undefined;
      customHighlightEnd = undefined;
    } else {
      customHighlightStart = date;
      customHighlightEnd = date;
    }
  }

  function handleHeatmapDayClick(dateStr: string) {
    if (selectedHeatmapDay === dateStr) {
      selectedHeatmapDay = null;
      toggleHighlight(undefined);
    } else {
      selectedHeatmapDay = dateStr;
      toggleHighlight(dateStr);
    }
  }

  // Reset offset when period changes
  $effect(() => {
    selectedPeriod;
    periodOffset = 0;
    charAvgIndex = 0;
    timeAvgIndex = 0;
    if (selectedPeriod !== "Custom") {
      customHighlightStart = undefined;
      customHighlightEnd = undefined;
    }
  });

  let baseDate = $derived.by(() => {
    let bDate = new Date();
    if (baseData.length > 0) {
      const maxTime = max(baseData, (d) => parseISO(d.date).getTime());
      if (maxTime) bDate = new Date(maxTime);
    }
    return bDate;
  });

  let refDate = $derived.by(() => {
    let rDate = baseDate;
    if (periodOffset !== 0) {
      if (selectedPeriod === "Week")
        rDate =
          periodOffset > 0
            ? addDays(baseDate, periodOffset * 7)
            : subDays(baseDate, -periodOffset * 7);
      if (selectedPeriod === "Month")
        rDate =
          periodOffset > 0
            ? addMonths(baseDate, periodOffset)
            : subMonths(baseDate, -periodOffset);
      if (selectedPeriod === "Year")
        rDate =
          periodOffset > 0
            ? addYears(baseDate, periodOffset)
            : subYears(baseDate, -periodOffset);
    }
    return rDate;
  });

  const getLocalStreak = (dataArray: typeof baseData) => {
    const uniqueDaySet = new Set(dataArray.map((d) => d.date));
    if (uniqueDaySet.size === 0) {
      return { count: 0, start: null as string | null, end: null as string | null };
    }
    const sortedAsc = Array.from(uniqueDaySet)
      .map((d) => ({ time: parseISO(d).getTime(), dateStr: d }))
      .sort((a, b) => a.time - b.time);
    let best = 1;
    let bestStart = sortedAsc[0].dateStr;
    let bestEnd = sortedAsc[0].dateStr;
    let run = 1;
    let runStart = sortedAsc[0].dateStr;
    for (let i = 1; i < sortedAsc.length; i++) {
      const diff = (sortedAsc[i].time - sortedAsc[i - 1].time) / 86400000;
      if (diff <= 1.1) {
        run++;
      } else {
        run = 1;
        runStart = sortedAsc[i].dateStr;
      }
      if (run > best) {
        best = run;
        bestStart = runStart;
        bestEnd = sortedAsc[i].dateStr;
      }
    }
    return { count: best, start: bestStart, end: bestEnd };
  };

  const getSessionExtremes = (dataArray: typeof baseData) => {
    const dailyMap = new Map<string, { chars: number; time: number }>();
    for (const d of dataArray) {
      if (!dailyMap.has(d.date)) dailyMap.set(d.date, { chars: 0, time: 0 });
      const current = dailyMap.get(d.date)!;
      current.chars += d.chars_read;
      current.time += d.time_read;
    }

    let bestChars = 0,
      worstChars = Infinity,
      bestCharsDate: string | undefined = undefined,
      worstCharsDate: string | undefined = undefined;
    let bestTime = 0,
      worstTime = Infinity,
      bestTimeDate: string | undefined = undefined,
      worstTimeDate: string | undefined = undefined;
    let bestSpeed = 0,
      worstSpeed = Infinity,
      bestSpeedDate: string | undefined = undefined,
      worstSpeedDate: string | undefined = undefined;

    for (const [date, { chars, time }] of dailyMap.entries()) {
      if (time >= 300) {
        if (chars > bestChars) {
          bestChars = chars;
          bestCharsDate = date;
        }
        if (chars < worstChars) {
          worstChars = chars;
          worstCharsDate = date;
        }
        if (time > bestTime) {
          bestTime = time;
          bestTimeDate = date;
        }
        if (time < worstTime) {
          worstTime = time;
          worstTimeDate = date;
        }

        const speed = time > 0 ? (chars / time) * 3600 : 0;
        if (speed > bestSpeed) {
          bestSpeed = speed;
          bestSpeedDate = date;
        }
        if (speed < worstSpeed) {
          worstSpeed = speed;
          worstSpeedDate = date;
        }
      }
    }

    return {
      bestChars: bestChars === Infinity ? 0 : bestChars,
      worstChars: worstChars === Infinity ? 0 : worstChars,
      bestTime: bestTime === Infinity ? 0 : bestTime,
      worstTime: worstTime === Infinity ? 0 : worstTime,
      bestSpeed: bestSpeed === Infinity ? 0 : Math.round(bestSpeed),
      worstSpeed: worstSpeed === Infinity ? 0 : Math.round(worstSpeed),
      bestCharsDate,
      worstCharsDate,
      bestTimeDate,
      worstTimeDate,
      bestSpeedDate,
      worstSpeedDate,
    };
  };

  function changePeriodOffset(delta: number) {
    periodOffset += delta;
    let rDate = baseDate;
    if (periodOffset !== 0) {
      if (selectedPeriod === "Week")
        rDate =
          periodOffset > 0
            ? addDays(baseDate, periodOffset * 7)
            : subDays(baseDate, -periodOffset * 7);
      if (selectedPeriod === "Month")
        rDate =
          periodOffset > 0
            ? addMonths(baseDate, periodOffset)
            : subMonths(baseDate, -periodOffset);
      if (selectedPeriod === "Year")
        rDate =
          periodOffset > 0
            ? addYears(baseDate, periodOffset)
            : subYears(baseDate, -periodOffset);
    }

    if (!enableAllTimeView) {
      const newYearStart = new Date(getYear(rDate), 0, 1);
      if (newYearStart.getTime() !== selectedYearStart.getTime()) {
        selectedYearStart = newYearStart;
      }
    }
  }

  let periodData = $derived.by(() => {
    if (selectedPeriod === "Custom" && customPeriodStart && customPeriodEnd) {
      const sDate = parseISO(customPeriodStart);
      const eDate = parseISO(customPeriodEnd);
      let customData = statsBaseData.filter((d) => {
        const dDate = parseISO(d.date);
        return dDate >= sDate && dDate <= eDate;
      });
      const activeDaysCustom = new Set(customData.map((d) => d.date)).size;
      const computedSpan = Math.max(1, differenceInDays(eDate, sDate) + 1);
      const totalChars = sum(customData, (d) => d.chars_read) || 0;
      const totalTime = sum(customData, (d) => d.time_read) || 0;

      const streakCustom = getLocalStreak(customData);
      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / computedSpan),
        time: totalTime / computedSpan,
        sessionChars:
          activeDaysCustom > 0 ? Math.round(totalChars / activeDaysCustom) : 0,
        sessionTime: activeDaysCustom > 0 ? totalTime / activeDaysCustom : 0,
        localActiveDays: activeDaysCustom,
        localBestStreak: streakCustom.count,
        localBestStreakStart: streakCustom.start,
        localBestStreakEnd: streakCustom.end,
        label: "daily average",
        totalChars,
        totalTime,
        totalTitles: new Set(customData.map((d) => d.name)).size,
        periodStart: customPeriodStart,
        periodEnd: customPeriodEnd,
        totalLabel:
          customPeriodStart === customPeriodEnd
            ? formatDate(sDate, "MMM d, yyyy")
            : `${formatDate(sDate, "MMM d")} - ${formatDate(eDate, "MMM d, yyyy")}`,
        spanDays: computedSpan,
        ...getSessionExtremes(customData),
      };
    }

    if (selectedPeriod === "Week") {
      let weeklyData = statsBaseData.filter((d) => {
        const diff = differenceInDays(refDate, parseISO(d.date));
        return diff >= 0 && diff <= 6;
      });
      const activeDaysWeek = new Set(weeklyData.map((d) => d.date)).size;
      const totalChars = sum(weeklyData, (d) => d.chars_read) || 0;
      const totalTime = sum(weeklyData, (d) => d.time_read) || 0;
      const streakWeek = getLocalStreak(weeklyData);
      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / 7),
        time: totalTime / 7,
        sessionChars:
          activeDaysWeek > 0 ? Math.round(totalChars / activeDaysWeek) : 0,
        sessionTime: activeDaysWeek > 0 ? totalTime / activeDaysWeek : 0,
        localActiveDays: activeDaysWeek,
        localBestStreak: streakWeek.count,
        localBestStreakStart: streakWeek.start,
        localBestStreakEnd: streakWeek.end,
        label: "daily average",
        totalChars,
        totalTime,
        totalTitles: new Set(weeklyData.map((d) => d.name)).size,
        periodStart: formatDate(subDays(refDate, 6), "yyyy-MM-dd"),
        periodEnd: formatDate(refDate, "yyyy-MM-dd"),
        totalLabel:
          formatDate(subDays(refDate, 6), "MMM d") +
          " - " +
          formatDate(refDate, "MMM d, yyyy"),
        spanDays: 7,
        ...getSessionExtremes(weeklyData),
      };
    }

    if (selectedPeriod === "Month") {
      let monthlyData = statsBaseData.filter((d) =>
        isSameMonth(parseISO(d.date), refDate),
      );
      const activeDaysMonth = new Set(monthlyData.map((d) => d.date)).size;
      const daysInMonth = new Date(
        refDate.getFullYear(),
        refDate.getMonth() + 1,
        0,
      ).getDate();
      const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
      const computedSpan = isSameMonth(new Date(), refDate)
        ? Math.max(1, differenceInDays(new Date(), monthStart) + 1)
        : daysInMonth;
      const totalChars = sum(monthlyData, (d) => d.chars_read) || 0;
      const totalTime = sum(monthlyData, (d) => d.time_read) || 0;
      const streakMonth = getLocalStreak(monthlyData);

      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / computedSpan),
        time: totalTime / computedSpan,
        sessionChars:
          activeDaysMonth > 0 ? Math.round(totalChars / activeDaysMonth) : 0,
        sessionTime: activeDaysMonth > 0 ? totalTime / activeDaysMonth : 0,
        localActiveDays: activeDaysMonth,
        localBestStreak: streakMonth.count,
        localBestStreakStart: streakMonth.start,
        localBestStreakEnd: streakMonth.end,
        label: "daily average",
        totalChars,
        totalTime,
        totalTitles: new Set(monthlyData.map((d) => d.name)).size,
        periodStart: formatDate(monthStart, "yyyy-MM-dd"),
        periodEnd: formatDate(
          new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0),
          "yyyy-MM-dd",
        ),
        totalLabel: formatDate(refDate, "MMM yyyy"),
        spanDays: computedSpan,
        ...getSessionExtremes(monthlyData),
      };
    }

    if (selectedPeriod === "Year") {
      let yearlyData = statsBaseData.filter((d) =>
        isSameYear(parseISO(d.date), refDate),
      );
      const activeDaysYear = new Set(yearlyData.map((d) => d.date)).size;
      const isLeapYear =
        new Date(refDate.getFullYear(), 1, 29).getMonth() === 1;
      const daysInYear = isLeapYear ? 366 : 365;
      const yearStart = new Date(refDate.getFullYear(), 0, 1);
      const computedSpan = isSameYear(new Date(), refDate)
        ? Math.max(1, differenceInDays(new Date(), yearStart) + 1)
        : daysInYear;
      const totalChars = sum(yearlyData, (d) => d.chars_read) || 0;
      const totalTime = sum(yearlyData, (d) => d.time_read) || 0;
      const streakYear = getLocalStreak(yearlyData);

      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / computedSpan),
        time: totalTime / computedSpan,
        sessionChars:
          activeDaysYear > 0 ? Math.round(totalChars / activeDaysYear) : 0,
        sessionTime: activeDaysYear > 0 ? totalTime / activeDaysYear : 0,
        localActiveDays: activeDaysYear,
        localBestStreak: streakYear.count,
        localBestStreakStart: streakYear.start,
        localBestStreakEnd: streakYear.end,
        label: "daily average",
        totalChars,
        totalTime,
        totalTitles: new Set(yearlyData.map((d) => d.name)).size,
        periodStart: formatDate(yearStart, "yyyy-MM-dd"),
        periodEnd: formatDate(
          new Date(refDate.getFullYear(), 11, 31),
          "yyyy-MM-dd",
        ),
        totalLabel: formatDate(refDate, "yyyy"),
        spanDays: computedSpan,
        ...getSessionExtremes(yearlyData),
      };
    }

    // All Time — read directly from processedData so this is independent of
    // the header year picker and the year-scoped selectedGames filter.
    let allData = processedData
      .filter((d) => mediaType === "all" || d.type === mediaType)
      .filter((d) => !legendSelectedGroup || d.name === legendSelectedGroup);

    const activeDaysAll = new Set(allData.map((d) => d.date)).size;
    const totalChars = sum(allData, (d) => d.chars_read) || 0;
    const totalTime = sum(allData, (d) => d.time_read) || 0;

    const dates = allData.map((d) => parseISO(d.date));
    const earliest =
      dates.length > 0
        ? new Date(Math.min(...dates.map((d) => d.getTime())))
        : new Date();
    const latest =
      dates.length > 0
        ? new Date(Math.max(...dates.map((d) => d.getTime())))
        : new Date();
    const spanDays = Math.max(1, differenceInDays(latest, earliest) + 1);
    const streakAll = getLocalStreak(allData);

    return {
      avgSpeed: totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
      chars: Math.round(totalChars / spanDays),
      time: totalTime / spanDays,
      sessionChars:
        activeDaysAll > 0 ? Math.round(totalChars / activeDaysAll) : 0,
      sessionTime: activeDaysAll > 0 ? totalTime / activeDaysAll : 0,
      localActiveDays: activeDaysAll,
      localBestStreak: streakAll.count,
      localBestStreakStart: streakAll.start,
      localBestStreakEnd: streakAll.end,
      label: "daily average",
      totalChars,
      totalTime,
      totalTitles: new Set(allData.map((d) => d.name)).size,
      periodStart: formatDate(earliest, "yyyy-MM-dd"),
      periodEnd: formatDate(latest, "yyyy-MM-dd"),
      totalLabel: "All Time",
      spanDays,
      ...getSessionExtremes(allData),
    };
  });

  let isCurrentStreakSelected = $derived(
    selectedPeriod === "Custom" &&
      statCards.currentStreakStart !== null &&
      customPeriodStart === statCards.currentStreakStart &&
      customPeriodEnd === statCards.currentStreakEnd,
  );

  let isBestStreakSelected = $derived(
    selectedPeriod === "Custom" &&
      (periodData.localBestStreakStart || statCards.bestStreakStart) !== null &&
      customPeriodStart ===
        (periodData.localBestStreakStart || statCards.bestStreakStart) &&
      customPeriodEnd ===
        (periodData.localBestStreakEnd || statCards.bestStreakEnd),
  );

  let activeSubPeriods = $derived.by(() => {
    if (selectedPeriod === "Week") return ["Day"];
    if (selectedPeriod === "Month") return ["Day", "Week"];
    if (selectedPeriod === "Custom") {
      return (periodData.spanDays || 0) > 60
        ? ["Day", "Week", "Month"]
        : ["Day", "Week"];
    }
    if (selectedPeriod === "Year") return ["Day", "Month", "Week"];
    return ["Day", "Month", "Week", "Year"];
  });
  let charAvgExpanded = $state(false);
  let timeAvgExpanded = $state(false);

  const tweenOpts = { duration: 400, easing: cubicOut };
  const twTotalChars = tweened(0, tweenOpts);
  const twTotalTime = tweened(0, tweenOpts);
  const twTotalTitles = tweened(0, tweenOpts);
  const twAvgSpeed = tweened(0, tweenOpts);
  const twSessionChars = tweened(0, tweenOpts);
  const twSessionTime = tweened(0, tweenOpts);

  $effect(() => {
    const opts = disableAnimations ? { duration: 0 } : tweenOpts;
    twTotalChars.set(periodData.totalChars || 0, opts);
    twTotalTime.set(periodData.totalTime || 0, opts);
    twTotalTitles.set(periodData.totalTitles || 0, opts);
    twAvgSpeed.set(periodData.avgSpeed || 0, opts);
    twSessionChars.set(periodData.sessionChars || 0, opts);
    twSessionTime.set(periodData.sessionTime || 0, opts);
  });

  let charAveragesList = $derived.by(() => {
    const total = periodData.totalChars;
    const days = periodData.spanDays ?? 1;
    return activeSubPeriods.map((g) => {
      if (g === "Day") return days > 0 ? total / days : 0;
      if (g === "Week") return days > 0 ? total / (days / 7) : 0;
      if (g === "Month") return days > 0 ? total / (days / 30.436875) : 0;
      if (g === "Year") return days > 0 ? total / (days / 365.2425) : 0;
      return 0;
    });
  });
  let timeAveragesList = $derived.by(() => {
    const total = periodData.totalTime;
    const days = periodData.spanDays ?? 1;
    return activeSubPeriods.map((g) => {
      if (g === "Day") return days > 0 ? total / days : 0;
      if (g === "Week") return days > 0 ? total / (days / 7) : 0;
      if (g === "Month") return days > 0 ? total / (days / 30.436875) : 0;
      if (g === "Year") return days > 0 ? total / (days / 365.2425) : 0;
      return 0;
    });
  });
  // ---- Detailed Statistics State & Logic ----
  type StatKey = "chars" | "time" | "speed" | "sessionChars" | "sessionTime";
  let detailOpen = $state(false);
  let detailStatKey = $state<StatKey>("chars");
  let monthSubPeriod = $state<"Week" | "Day" | "Month">("Week");
  let allTimeSubPeriod = $state<"Year" | "Month">("Year");
  let hoveredPointIndex = $state<number | null>(null);
  let chartWidth = $state(800);

  const STAT_CONFIG: Record<
    StatKey,
    { label: string; unit: string; fmt: (v: number) => string }
  > = {
    chars: {
      label: "Characters",
      unit: "characters",
      fmt: (v: number) => fmtChars(v),
    },
    time: {
      label: "Time Read",
      unit: "time",
      fmt: (v: number) => fmtTime(v),
    },
    speed: {
      label: "Reading Speed",
      unit: "chars / hour",
      fmt: (v: number) => `${Math.round(v).toLocaleString()} /h`,
    },
    sessionChars: {
      label: "Chars / Session",
      unit: "chars / session",
      fmt: (v: number) => fmtChars(v),
    },
    sessionTime: {
      label: "Time / Session",
      unit: "time / session",
      fmt: (v: number) => fmtTime(v),
    },
  };

  function formatYAxisTick(v: number, key: StatKey): string {
    if (v <= 0) return "0";
    if (key === "chars" || key === "sessionChars") {
      if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
      if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
      return `${Math.round(v)}`;
    }
    if (key === "time" || key === "sessionTime") {
      const h = Math.floor(v / 3600);
      const m = Math.round((v % 3600) / 60);
      if (h > 0 && m > 0) return `${h}h ${m}m`;
      if (h > 0) return `${h}h`;
      return `${m}m`;
    }
    if (key === "speed") {
      if (v >= 1_000) return `${Math.round(v / 1_000)}k/h`;
      return `${Math.round(v)}/h`;
    }
    return `${Math.round(v)}`;
  }

  function selectStat(key: StatKey) {
    detailStatKey = key;
    detailOpen = true;
  }

  let detailGranularity = $derived.by<"Day" | "Week" | "Month" | "Year">(() => {
    if (selectedPeriod === "Week") return "Day";
    if (selectedPeriod === "Month") return monthSubPeriod === "Month" ? "Week" : monthSubPeriod;
    if (selectedPeriod === "Custom") {
      if (monthSubPeriod === "Month" && (periodData.spanDays || 0) <= 60) {
        return "Week";
      }
      return monthSubPeriod;
    }
    if (selectedPeriod === "Year") return "Month";
    return allTimeSubPeriod;
  });

  interface DetailBucket {
    label: string;
    chars: number;
    time: number;
    speed: number;
    sessionChars: number;
    sessionTime: number;
    activeDays: number;
    value: number;
  }

  let detailBuckets = $derived.by<DetailBucket[]>(() => {
    const buckets: {
      label: string;
      filterFn: (d: (typeof statsFilteredData)[0]) => boolean;
    }[] = [];

    if (selectedPeriod === "Custom" && customPeriodStart && customPeriodEnd) {
      const cStart = parseISO(customPeriodStart);
      const cEnd = parseISO(customPeriodEnd);

      if (detailGranularity === "Day") {
        const days = eachDayOfInterval({ start: cStart, end: cEnd });
        const span = differenceInDays(cEnd, cStart) + 1;
        for (const d of days) {
          const dStr = formatDate(d, "yyyy-MM-dd");
          buckets.push({
            label: span <= 14 ? formatDate(d, "EEE d") : formatDate(d, "MMM d"),
            filterFn: (entry) => entry.date === dStr,
          });
        }
      } else if (detailGranularity === "Month") {
        const months = eachMonthOfInterval({ start: cStart, end: cEnd });
        for (const m of months) {
          buckets.push({
            label: differenceInDays(cEnd, cStart) > 365 ? formatDate(m, "MMM yy") : formatDate(m, "MMM"),
            filterFn: (entry) => {
              const eDate = parseISO(entry.date);
              return isSameMonth(eDate, m) && isSameYear(eDate, m);
            },
          });
        }
      } else {
        const weeks = eachWeekOfInterval(
          { start: cStart, end: cEnd },
          { weekStartsOn: 0 }
        );
        for (let i = 0; i < weeks.length; i++) {
          const wS = weeks[i];
          const wE = min([addDays(wS, 6), cEnd]) ?? cEnd;
          buckets.push({
            label: formatDate(wS, "MMM d"),
            filterFn: (entry) => {
              const eDate = parseISO(entry.date);
              return eDate >= wS && eDate <= wE;
            },
          });
        }
      }
    } else if (selectedPeriod === "Week") {
      const days = eachDayOfInterval({
        start: subDays(refDate, 6),
        end: refDate,
      });
      for (const d of days) {
        const dStr = formatDate(d, "yyyy-MM-dd");
        buckets.push({
          label: formatDate(d, "EEE d"),
          filterFn: (entry) => entry.date === dStr,
        });
      }
    } else if (selectedPeriod === "Month") {
      const mStart = startOfMonth(refDate);
      const mEnd = endOfMonth(refDate);

      if (detailGranularity === "Day") {
        const days = eachDayOfInterval({ start: mStart, end: mEnd });
        for (const d of days) {
          const dStr = formatDate(d, "yyyy-MM-dd");
          buckets.push({
            label: formatDate(d, "d"),
            filterFn: (entry) => entry.date === dStr,
          });
        }
      } else {
        const weeks = eachWeekOfInterval(
          { start: mStart, end: mEnd },
          { weekStartsOn: 0 }
        );
        for (let i = 0; i < weeks.length; i++) {
          const wS = weeks[i];
          const wE = min([addDays(wS, 6), mEnd]) ?? mEnd;
          buckets.push({
            label: formatDate(wS, "MMM d"),
            filterFn: (entry) => {
              const eDate = parseISO(entry.date);
              return eDate >= wS && eDate <= wE;
            },
          });
        }
      }
    } else if (selectedPeriod === "Year") {
      const yStart = startOfYear(refDate);
      const yEnd = endOfYear(refDate);
      const months = eachMonthOfInterval({ start: yStart, end: yEnd });
      for (const m of months) {
        buckets.push({
          label: formatDate(m, "MMM"),
          filterFn: (entry) =>
            isSameMonth(parseISO(entry.date), m) &&
            isSameYear(parseISO(entry.date), m),
        });
      }
    } else {
      // All Time
      if (detailGranularity === "Year") {
        const allDates = statsFilteredData.map((d) => parseISO(d.date));
        const minY =
          allDates.length > 0
            ? Math.min(...allDates.map((d) => d.getFullYear()))
            : new Date().getFullYear();
        const maxY =
          allDates.length > 0
            ? Math.max(...allDates.map((d) => d.getFullYear()))
            : new Date().getFullYear();
        for (let y = minY; y <= maxY; y++) {
          buckets.push({
            label: String(y),
            filterFn: (entry) => parseISO(entry.date).getFullYear() === y,
          });
        }
      } else {
        const allDates = statsFilteredData.map((d) => parseISO(d.date));
        const minD =
          allDates.length > 0
            ? new Date(Math.min(...allDates.map((d) => d.getTime())))
            : new Date();
        const maxD =
          allDates.length > 0
            ? new Date(Math.max(...allDates.map((d) => d.getTime())))
            : new Date();
        const months = eachMonthOfInterval({
          start: startOfMonth(minD),
          end: endOfMonth(maxD),
        });
        for (const m of months) {
          buckets.push({
            label: formatDate(m, "MMM yy"),
            filterFn: (entry) =>
              isSameMonth(parseISO(entry.date), m) &&
              isSameYear(parseISO(entry.date), m),
          });
        }
      }
    }

    return buckets.map((b) => {
      const entries = statsFilteredData.filter(b.filterFn);
      const chars = sum(entries, (e) => e.chars_read) || 0;
      const time = sum(entries, (e) => e.time_read) || 0;
      const activeDays = new Set(entries.map((e) => e.date)).size;
      const speed =
        time > 0 ? Math.round((chars / time) * 3600) : 0;
      const sessionChars =
        activeDays > 0 ? Math.round(chars / activeDays) : 0;
      const sessionTime = activeDays > 0 ? time / activeDays : 0;

      let value = chars;
      if (detailStatKey === "time") value = time;
      else if (detailStatKey === "speed") value = speed;
      else if (detailStatKey === "sessionChars") value = sessionChars;
      else if (detailStatKey === "sessionTime") value = sessionTime;

      return {
        label: b.label,
        chars,
        time,
        speed,
        sessionChars,
        sessionTime,
        activeDays,
        value,
      };
    });
  });

  let bestSessions = $derived.by(() => {
    const dailyMap = new Map<string, typeof statsBaseData>();
    for (const d of statsBaseData) {
      if (!dailyMap.has(d.date)) dailyMap.set(d.date, []);
      dailyMap.get(d.date)!.push(d);
    }
    const list = Array.from(dailyMap.entries()).map(([date, entries]) => {
      const chars = sum(entries, (e) => e.chars_read) || 0;
      const time = sum(entries, (e) => e.time_read) || 0;
      const speed =
        time >= 60
          ? Math.round((chars / time) * 3600)
          : time > 0
            ? Math.round((chars / time) * 3600)
            : 0;
      return {
        date,
        periodStart: date,
        periodEnd: date,
        label: formatDate(parseISO(date), "EEE, MMM d, yyyy"),
        chars,
        time,
        speed,
        sessionChars: chars,
        sessionTime: time,
      };
    });

    list.sort((a, b) => {
      if (detailStatKey === "chars" || detailStatKey === "sessionChars")
        return b.chars - a.chars;
      if (detailStatKey === "time" || detailStatKey === "sessionTime")
        return b.time - a.time;
      if (detailStatKey === "speed") return b.speed - a.speed;
      return 0;
    });

    return list.slice(0, 5);
  });

  let bestWeeks = $derived.by(() => {
    const weekMap = new Map<string, typeof statsBaseData>();
    for (const d of statsBaseData) {
      const wStart = formatDate(
        startOfWeek(parseISO(d.date), { weekStartsOn: 0 }),
        "yyyy-MM-dd"
      );
      if (!weekMap.has(wStart)) weekMap.set(wStart, []);
      weekMap.get(wStart)!.push(d);
    }
    const list = Array.from(weekMap.entries()).map(([wStart, entries]) => {
      const wStartDate = parseISO(wStart);
      const wEndDate = addDays(wStartDate, 6);
      const wEnd = formatDate(wEndDate, "yyyy-MM-dd");
      const chars = sum(entries, (e) => e.chars_read) || 0;
      const time = sum(entries, (e) => e.time_read) || 0;
      const activeDays = new Set(entries.map((e) => e.date)).size;
      const speed = time > 0 ? Math.round((chars / time) * 3600) : 0;
      const sessionChars =
        activeDays > 0 ? Math.round(chars / activeDays) : 0;
      const sessionTime = activeDays > 0 ? time / activeDays : 0;
      return {
        periodStart: wStart,
        periodEnd: wEnd,
        label: `${formatDate(wStartDate, "MMM d")} - ${formatDate(wEndDate, "MMM d, yyyy")}`,
        chars,
        time,
        speed,
        sessionChars,
        sessionTime,
        activeDays,
      };
    });

    list.sort((a, b) => {
      if (detailStatKey === "chars") return b.chars - a.chars;
      if (detailStatKey === "time") return b.time - a.time;
      if (detailStatKey === "speed") return b.speed - a.speed;
      if (detailStatKey === "sessionChars")
        return b.sessionChars - a.sessionChars;
      if (detailStatKey === "sessionTime")
        return b.sessionTime - a.sessionTime;
      return 0;
    });

    return list.slice(0, 5);
  });

  let bestMonths = $derived.by(() => {
    const monthMap = new Map<string, typeof statsBaseData>();
    for (const d of statsBaseData) {
      const mKey = d.date.substring(0, 7);
      if (!monthMap.has(mKey)) monthMap.set(mKey, []);
      monthMap.get(mKey)!.push(d);
    }
    const list = Array.from(monthMap.entries()).map(([mKey, entries]) => {
      const mStartDate = parseISO(`${mKey}-01`);
      const mEndDate = endOfMonth(mStartDate);
      const mStart = formatDate(mStartDate, "yyyy-MM-dd");
      const mEnd = formatDate(mEndDate, "yyyy-MM-dd");
      const chars = sum(entries, (e) => e.chars_read) || 0;
      const time = sum(entries, (e) => e.time_read) || 0;
      const activeDays = new Set(entries.map((e) => e.date)).size;
      const speed = time > 0 ? Math.round((chars / time) * 3600) : 0;
      const sessionChars =
        activeDays > 0 ? Math.round(chars / activeDays) : 0;
      const sessionTime = activeDays > 0 ? time / activeDays : 0;
      return {
        periodStart: mStart,
        periodEnd: mEnd,
        label: formatDate(mStartDate, "MMMM yyyy"),
        chars,
        time,
        speed,
        sessionChars,
        sessionTime,
        activeDays,
      };
    });

    list.sort((a, b) => {
      if (detailStatKey === "chars") return b.chars - a.chars;
      if (detailStatKey === "time") return b.time - a.time;
      if (detailStatKey === "speed") return b.speed - a.speed;
      if (detailStatKey === "sessionChars")
        return b.sessionChars - a.sessionChars;
      if (detailStatKey === "sessionTime")
        return b.sessionTime - a.sessionTime;
      return 0;
    });

    return list.slice(0, 5);
  });

  function handleBestItemClick(
    type: "session" | "week" | "month",
    item: { periodStart: string; periodEnd: string }
  ) {
    if (
      customHighlightStart === item.periodStart &&
      customHighlightEnd === item.periodEnd
    ) {
      customHighlightStart = undefined;
      customHighlightEnd = undefined;
      return;
    }

    const targetDate = parseISO(item.periodEnd);
    customHighlightStart = item.periodStart;
    customHighlightEnd = item.periodEnd;

    if (type === "session") {
      if (!enableAllTimeView) {
        const itemYear = targetDate.getFullYear();
        if (getYear(selectedYearStart) !== itemYear) {
          selectedYearStart = new Date(itemYear, 0, 1);
        }
      }
    } else if (type === "week") {
      selectedPeriod = "Week";
      if (!enableAllTimeView) {
        selectedYearStart = new Date(targetDate.getFullYear(), 0, 1);
      }
      const bDate = baseDate;
      periodOffset = Math.round(differenceInDays(targetDate, bDate) / 7);
    } else if (type === "month") {
      selectedPeriod = "Month";
      if (!enableAllTimeView) {
        selectedYearStart = new Date(targetDate.getFullYear(), 0, 1);
      }
      const bDate = baseDate;
      periodOffset =
        (targetDate.getFullYear() - bDate.getFullYear()) * 12 +
        (targetDate.getMonth() - bDate.getMonth());
    }
  }
</script>

<svelte:window onclick={closeAllMenus} onscroll={closeAllMenus} />

<div class="flex flex-col gap-10 px-20">
  <!-- Top Bar -->
  <div
    id="top_bar"
    class="sticky top-0 z-50 flex h-20 items-center justify-between relative"
  >
    <div class="flex flex-row items-center gap-2">
      <button
        class="material-icons header-text header-icon"
        onclick={previousPeriod}>navigate_before</button
      >
    </div>
    <div class="absolute left-1/2 -translate-x-1/2 flex flex-row place-items-center gap-3 pointer-events-none">
      <p class="header-text pointer-events-auto">{displayTime}</p>
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
        <h2 class="text-lg font-semibold text-title">Filter Games</h2>
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

  {#if showGamePanel}
    <div class="panel" id="manage_panel">
      <div class="mb-3 flex items-center gap-3">
        <select
          class="bg-button rounded px-2.5 py-1 text-sm font-medium text-white outline-none cursor-pointer"
          bind:value={mediaType}
        >
          <option value="all">All</option>
          <option value="vn">VN</option>
          <option value="mokuro">Mokuro</option>
          <option value="ttu">TTU</option>
        </select>
        <h2 class="text-lg font-semibold text-title">Manage Games</h2>
      </div>

      <!-- Add / Edit Stats for any tracked game -->
      <div class="mb-4">
        <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Add / Edit Stats</p>

        <!-- New Title form -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="New title name…"
            bind:value={newTitleName}
            onkeydown={(e) => { if (e.key === "Enter") createTitle(); }}
            class="rename-input min-w-48 flex-1"
          />
          <select bind:value={newTitleType} class="rounded panel-input px-2 py-1 text-sm">
            <option value="vn">VN</option>
            <option value="mokuro">Mokuro</option>
            <option value="ttu">TTU</option>
          </select>
          <button
            class="btn-sm btn-primary"
            disabled={creatingTitle || !newTitleName.trim()}
            onclick={createTitle}
          >
            {creatingTitle ? "Creating…" : "+ Create"}
          </button>
        </div>

        {#if editingGame && !uniqueGames.some((g) => g.uuid === editingGame?.uuid)}
          <div class="mt-3 panel-sub" id="game-editor-{editingGame.uuid}">
            <h3 class="mb-3 text-sm font-semibold text-title">Edit Stats — {editingGame.name}</h3>
            <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <label class="flex items-center gap-1 text-sub">Chars
                <input type="number" min="0" bind:value={editChars} class="w-24 rounded panel-input px-2 py-1" />
              </label>
              <label class="flex items-center gap-1 text-sub">Time
                <input type="number" min="0" max="23" bind:value={editHours} class="w-14 rounded panel-input px-2 py-1" />h
                <input type="number" min="0" max="59" bind:value={editMins} class="w-14 rounded panel-input px-2 py-1" />m
                <input type="number" min="0" max="59" bind:value={editSecs} class="w-14 rounded panel-input px-2 py-1" />s
              </label>
            </div>
            <p class="mb-1 text-xs text-muted">👆 Click or drag dates on the heatmap above to select them.</p>
            {#if recalcMsg}
              <p class="mb-1 text-xs text-emerald-400">✓ {recalcMsg}</p>
            {/if}
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex gap-2">
                <button class="btn-sm btn-primary" disabled={editSaving || editSelectedDates.size === 0} onclick={applyStats}>
                  {editSaving ? 'Saving…' : 'Apply to ' + editSelectedDates.size + ' date' + (editSelectedDates.size !== 1 ? 's' : '')}
                </button>
                <button class="btn-sm btn-secondary" onclick={() => (editSelectedDates = new Set())}>Clear</button>
                <button class="btn-sm btn-secondary" disabled={editHistory.length === 0} onclick={undoLastApply}>↩ Undo ({editHistory.length})</button>
                <button
                  class="btn-sm btn-secondary"
                  disabled={recalculating || editSelectedDates.size !== 1}
                  onclick={recalculateFromLines}
                  title="Recount chars and lines from the lines stored for this date"
                >
                  {recalculating ? "Scanning…" : "↺ Recalculate"}
                </button>
              </div>
              <button class="btn-sm btn-primary" onclick={finishEdit}>Done</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Active Games -->
      <div class="space-y-1">
        {#each uniqueGames as game}
          <div class="game-row">
            <div class="flex min-w-0 flex-1 items-center gap-2">
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
                <span class="truncate text-sm text-strong">{game.name}</span>
                <span class="type-badge">{game.type}</span>
              {/if}
            </div>

            {#if renamingUuid !== game.uuid}
              <div class="flex shrink-0 gap-1">
                <button
                  class="btn-sm btn-secondary"
                  title="Rename"
                  onclick={() => startRename(game.uuid, game.name)}
                >
                  ✏️
                </button>

                <button
                  class="btn-sm btn-primary"
                  title="Edit Stats"
                  onclick={() => startEditStats(game)}
                >
                  📊
                </button>

                {#if confirmDeleteUuid === game.uuid}
                  <span class="mr-1 self-center text-xs text-red-400"
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

          <!-- Edit Stats sub-panel -->
          {#if editingGame?.uuid === game.uuid}
            <div class="mt-3 panel-sub" id="game-editor-{game.uuid}">
              <h3 class="mb-3 text-sm font-semibold text-title">Edit Stats — {game.name}</h3>

              <!-- Inputs -->
              <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label class="flex items-center gap-1 text-sub">
                  Chars
                  <input
                    type="number"
                    min="0"
                    bind:value={editChars}
                    class="w-24 rounded panel-input px-2 py-1"
                  />
                </label>
                <label class="flex items-center gap-1 text-sub">
                  Time
                  <input
                    type="number"
                    min="0"
                    max="23"
                    bind:value={editHours}
                    class="w-14 rounded panel-input px-2 py-1"
                  />h
                  <input
                    type="number"
                    min="0"
                    max="59"
                    bind:value={editMins}
                    class="w-14 rounded panel-input px-2 py-1"
                  />m
                  <input
                    type="number"
                    min="0"
                    max="59"
                    bind:value={editSecs}
                    class="w-14 rounded panel-input px-2 py-1"
                  />s
                </label>
              </div>

              <p class="mb-1 text-xs text-muted">👆 Click or drag dates on the heatmap above to select them.</p>

              {#if recalcMsg}
                <p class="mb-1 text-xs text-emerald-400">✓ {recalcMsg}</p>
              {/if}

              <!-- Action row -->
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex gap-2">
                  <button
                    class="btn-sm btn-primary"
                    disabled={editSaving || editSelectedDates.size === 0}
                    onclick={applyStats}
                  >
                    {editSaving ? "Saving…" : `Apply to ${editSelectedDates.size} date${editSelectedDates.size !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    class="btn-sm btn-secondary"
                    onclick={() => (editSelectedDates = new Set())}
                  >
                    Clear
                  </button>
                  <button
                    class="btn-sm btn-secondary"
                    disabled={editHistory.length === 0}
                    onclick={undoLastApply}
                  >
                    ↩ Undo ({editHistory.length})
                  </button>
                  <button
                    class="btn-sm btn-secondary"
                    disabled={recalculating || editSelectedDates.size !== 1}
                    onclick={recalculateFromLines}
                    title="Recount chars and lines from the lines stored for this date"
                  >
                    {recalculating ? "Scanning…" : "↺ Recalculate"}
                  </button>
                </div>
                <button class="btn-sm btn-primary" onclick={finishEdit}>Done</button>
              </div>
            </div>
          {/if}
        {/each}
        {#if uniqueGames.length === 0}
          <p class="py-2 text-xs text-muted">No games recorded in {displayTime}.</p>
        {/if}
      </div>

      <!-- Deleted Games -->
      {#if deletedGames.length > 0}
        <button
          class="mt-4 text-sm text-muted hover:text-strong"
          onclick={() => (showDeletedGames = !showDeletedGames)}
        >
          {showDeletedGames ? "▾" : "▸"} Deleted Games ({deletedGames.length})
        </button>

        {#if showDeletedGames}
          <div class="mt-2 space-y-1">
            {#each deletedGames as game}
              <div class="game-row game-row-deleted">
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span class="truncate text-sm text-muted line-through"
                    >{game.name}</span
                  >
                  <span class="type-badge">{game.type}</span>
                  <span class="text-[10px] text-muted">
                    {new Date(game.deleted_at).toLocaleDateString()}
                  </span>
                </div>
                <div class="flex shrink-0 gap-1">
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

      <!-- Merge Duplicates -->
      {#if duplicateGroups.length > 0}
        <button
          class="mt-4 text-sm text-yellow-400 hover:text-yellow-200"
          onclick={() => (showDuplicates = !showDuplicates)}
        >
          {showDuplicates ? "▾" : "▸"} Duplicate Titles ({duplicateGroups.length})
        </button>

        {#if showDuplicates}
          <div class="mt-2 space-y-1">
            {#each duplicateGroups as group}
              <div class="game-row items-center">
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span class="truncate text-sm text-yellow-300">{group.name}</span>
                  <span class="type-badge">{group.uuids.length} entries</span>
                </div>
                <button
                  class="btn-sm btn-primary shrink-0"
                  disabled={mergingGroup === group.name}
                  onclick={() => handleMerge(group)}
                >
                  {mergingGroup === group.name ? "Merging…" : "⊕ Merge"}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- Merge History -->
      {#if mergeHistory.length > 0}
        <div class="mt-4 border-t border-dim pt-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Merge History</p>
          <div class="space-y-1">
            {#each mergeHistory as snap}
              <div class="game-row items-center">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-sm text-strong">
                    <span class="text-accent">{snap.secondaryName}</span>
                    → <span class="text-accent">{snap.primaryName}</span>
                  </span>
                  <span class="text-[10px] text-muted">
                    {new Date(snap.timestamp).toLocaleString()}
                  </span>
                </div>
                <button
                  class="btn-sm btn-restore shrink-0"
                  disabled={undoingMerge === snap.timestamp}
                  onclick={() => handleUndoMerge(snap)}
                >
                  {undoingMerge === snap.timestamp ? "Restoring…" : "↩ Undo"}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if filteredData.length > 0}
    <!-- Activity & Streak Section -->
    <div
      class="activity-section flex w-full flex-col items-center gap-6 p-8"
    >
      <div class="grid grid-cols-3 items-end justify-items-center w-full max-w-lg mx-auto">
        <div class="flex flex-col items-center">
          <span class="text-4xl font-bold text-strong"
            >{periodData.localActiveDays}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-title"
            >Active Days</span
          >
        </div>
        <!-- Current Streak -->
        <button
          type="button"
          class="streak-click-btn flex flex-col items-center bg-transparent border-0 p-0 text-center {periodOffset === 0 && statCards.currentStreak > 0 ? 'cursor-pointer hover:opacity-80 transition-all hover:scale-105' : 'cursor-default'}"
          class:streak-selected={isCurrentStreakSelected}
          disabled={!(periodOffset === 0 && statCards.currentStreak > 0)}
          onclick={() => {
            if (
              periodOffset === 0 &&
              statCards.currentStreak > 0 &&
              statCards.currentStreakStart &&
              statCards.currentStreakEnd
            ) {
              toggleStreak(
                statCards.currentStreakStart,
                statCards.currentStreakEnd,
              );
            }
          }}
          title={periodOffset === 0 && statCards.currentStreak > 0 && statCards.currentStreakStart && statCards.currentStreakEnd
            ? isCurrentStreakSelected
              ? `Current streak selected: ${statCards.currentStreakStart} to ${statCards.currentStreakEnd} (click to deselect)`
              : `Current streak: ${statCards.currentStreakStart} to ${statCards.currentStreakEnd} (click to select)`
            : ""}
        >
          <span class="text-4xl font-bold text-title"
            >{periodOffset === 0 && statCards.currentStreak > 0
              ? statCards.currentStreak
              : "—"}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-title"
            >Current Streak</span
          >
        </button>

        <!-- Best Streak -->
        <button
          type="button"
          class="streak-click-btn flex flex-col items-center bg-transparent border-0 p-0 text-center {periodData.localBestStreak > 0 ? 'cursor-pointer hover:opacity-80 transition-all hover:scale-105' : 'cursor-default'}"
          class:streak-selected={isBestStreakSelected}
          disabled={!(periodData.localBestStreak > 0)}
          onclick={() => {
            const start = periodData.localBestStreakStart || statCards.bestStreakStart;
            const end = periodData.localBestStreakEnd || statCards.bestStreakEnd;
            if (start && end) {
              toggleStreak(start, end);
            }
          }}
          title={periodData.localBestStreak > 0 && (periodData.localBestStreakStart || statCards.bestStreakStart)
            ? isBestStreakSelected
              ? `Best streak selected: ${periodData.localBestStreakStart || statCards.bestStreakStart} to ${periodData.localBestStreakEnd || statCards.bestStreakEnd} (click to deselect)`
              : `Best streak: ${periodData.localBestStreakStart || statCards.bestStreakStart} to ${periodData.localBestStreakEnd || statCards.bestStreakEnd} (click to select)`
            : ""}
        >
          <span class="text-4xl font-bold text-muted"
            >{periodData.localBestStreak > 0
              ? periodData.localBestStreak
              : "—"}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-title"
            >Best Streak</span
          >
        </button>
      </div>

      {#if !enableAllTimeView}
        <div class="mt-2 w-full">
          <CalendarHeatmap
            data={date_summary}
            {date_accessor}
            metric_accessor={time_read_accessor}
            graph_title=""
            highlight_start={customHighlightStart ?? periodData.periodStart}
            highlight_end={customHighlightEnd ?? periodData.periodEnd}
            highlight_dates={legendHighlightDates}
            tooltip_accessors={heatmap_tooltip_accessors}
            tooltip_formatters={heatmap_tooltip_formatters}
            selectable={!!editingGame}
            selectedDates={editSelectedDates}
            onDateToggle={handleDateToggle}
            onDayClick={handleHeatmapDayClick}
            onDayContextMenu={handleDayContextMenu}
            viewYear={getYear(selectedYearStart)}
          />
        </div>
      {/if}
    </div>

    <!-- Reading Summary Cards -->
    <div class="stats-wrap">
      <h2 class="stats-title">Reading Summary</h2>

      <!-- Period tabs -->
      <div class="stats-tabs">
        {#each PERIODS as p}
          <button
            class="stats-tab"
            class:stats-tab-active={selectedPeriod === p}
            onclick={() => {
              showCustomDatePicker = false;
              selectPeriod(p);
            }}
            oncontextmenu={(e) => handlePeriodContextMenu(p, e)}
          >
            Per {p}
          </button>
        {/each}

        <!-- Custom Date Selection Tab -->
        <div class="relative inline-flex">
          <button
            type="button"
            class="stats-tab flex items-center gap-1.5 cursor-pointer"
            class:stats-tab-active={selectedPeriod === "Custom"}
            onclick={(e) => {
              e.stopPropagation();
              if (selectedPeriod !== "Custom" && customPeriodStart && customPeriodEnd) {
                selectedPeriod = "Custom";
                customHighlightStart = customPeriodStart;
                customHighlightEnd = customPeriodEnd;
              }
              showCustomDatePicker = !showCustomDatePicker;
            }}
            oncontextmenu={(e) => handlePeriodContextMenu("Custom", e)}
            title={selectedPeriod === "Custom" && customPeriodStart && customPeriodEnd ? `${customPeriodStart} to ${customPeriodEnd}` : "Choose custom date range"}
          >
            <svg class="h-3 w-3 shrink-0 inline-block {selectedPeriod === 'Custom' ? 'text-accent' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Custom</span>
          </button>

          {#if showCustomDatePicker}
            <DateRangePicker
              start={customPeriodStart}
              end={customPeriodEnd}
              onapply={applyCustomPeriod}
              onclose={() => (showCustomDatePicker = false)}
            />
          {/if}
        </div>
      </div>

      <!-- Totals -->
      <div class="stats-section-header">
        <div class="stats-line"></div>
        <span>Totals</span>
        <div class="stats-nav">
          <button
            class="stats-nav-btn"
            onclick={() => changePeriodOffset(-1)}
            disabled={selectedPeriod === "All Time" || selectedPeriod === "Custom"}>◀</button
          >
          <span class="stats-nav-label">{periodData.totalLabel}</span>
          <button
            class="stats-nav-btn"
            onclick={() => changePeriodOffset(1)}
            disabled={selectedPeriod === "All Time" || selectedPeriod === "Custom" || periodOffset >= 0}
            >▶</button
          >
        </div>
        <div class="stats-line"></div>
      </div>
      <div class="stats-grid stats-grid-5">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="stat-card stat-card-highlight cursor-pointer transition-all hover:scale-[1.01]"
          class:stat-card-selected={detailOpen && detailStatKey === "chars"}
          onclick={() => selectStat("chars")}
        >
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Characters</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{fmtChars($twTotalChars)}</span
          >
          <span class="stat-sub">{periodData.totalLabel}</span>
          {#if legendSelectedGroup}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="selected-game-title absolute bottom-2 right-4 max-w-[65%] truncate text-right font-mono text-xs tracking-wide cursor-pointer"
              title="{legendSelectedGroup} (click to clear)"
              onclick={(e) => {
                e.stopPropagation();
                legendSelectedGroup = null;
              }}
            >
              {legendSelectedGroup}
            </span>
          {:else}
            <span
              class="absolute bottom-2 right-4 text-right font-mono text-[10px] uppercase tracking-wide text-black/40"
            >
              {Math.round($twTotalTitles)} titles
            </span>
          {/if}

          {#if activeSubPeriods.length > 0}
            <div class="stat-divider"></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="relative flex w-full flex-wrap gap-x-4 gap-y-2 text-sm"
              onmouseenter={() => (charAvgExpanded = true)}
              onmouseleave={() => (charAvgExpanded = false)}
            >
              {#each activeSubPeriods.slice(0, charAvgExpanded ? activeSubPeriods.length : 2) as g, i}
                <div class="flex items-baseline gap-1">
                  <span
                    class="font-substat-num text-sm leading-none tracking-widest text-black"
                    >{fmtChars(charAveragesList[i])}</span
                  >
                  <span
                    class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                    >/{g.toLowerCase()}</span
                  >
                </div>
              {/each}

              {#if activeSubPeriods.length > 2 && !charAvgExpanded}
                <div
                  class="absolute -right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/5 text-black/40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2.5"
                    stroke="currentColor"
                    class="h-3 w-3"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="stat-card stat-card-highlight cursor-pointer transition-all hover:scale-[1.01]"
          class:stat-card-selected={detailOpen && detailStatKey === "time"}
          onclick={() => selectStat("time")}
        >
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Time Read</span>
          <span class="stat-value stat-value-lg">{fmtTime($twTotalTime)}</span>
          <span class="stat-sub">{periodData.totalLabel}</span>

          {#if activeSubPeriods.length > 0}
            <div class="stat-divider"></div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="relative flex w-full flex-wrap gap-x-4 gap-y-2 text-sm"
              onmouseenter={() => (timeAvgExpanded = true)}
              onmouseleave={() => (timeAvgExpanded = false)}
            >
              {#each activeSubPeriods.slice(0, timeAvgExpanded ? activeSubPeriods.length : 2) as g, i}
                <div class="flex items-baseline gap-1">
                  <span
                    class="font-substat-num text-sm leading-none tracking-widest text-black"
                    >{fmtTime(timeAveragesList[i])}</span
                  >
                  <span
                    class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                    >/{g.toLowerCase()}</span
                  >
                </div>
              {/each}

              {#if activeSubPeriods.length > 2 && !timeAvgExpanded}
                <div
                  class="absolute -right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/5 text-black/40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2.5"
                    stroke="currentColor"
                    class="h-3 w-3"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="stat-card stat-card-highlight cursor-pointer transition-all hover:scale-[1.01]"
          class:stat-card-selected={detailOpen && detailStatKey === "speed"}
          onclick={() => selectStat("speed")}
        >
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Reading Speed</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{Math.round($twAvgSpeed).toLocaleString()}</span
          >
          <span class="stat-sub">avg ch / hour</span>

          {#if periodData.bestSpeed !== undefined}
            <div class="stat-divider"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.bestSpeedDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >best session</span
                >
                <span
                  class="font-substat-num flex items-baseline gap-1 text-sm leading-none tracking-widest text-black"
                >
                  {Math.round(periodData.bestSpeed).toLocaleString()}
                  <span
                    class="font-substat-label text-[10px] font-normal normal-case tracking-normal text-black/60"
                    >/h</span
                  >
                </span>
              </div>
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.worstSpeedDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >worst session</span
                >
                <span
                  class="font-substat-num flex items-baseline gap-1 text-sm leading-none tracking-widest text-black"
                >
                  {Math.round(periodData.worstSpeed).toLocaleString()}
                  <span
                    class="font-substat-label text-[10px] font-normal normal-case tracking-normal text-black/60"
                    >/h</span
                  >
                </span>
              </div>
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="stat-card stat-card-highlight cursor-pointer transition-all hover:scale-[1.01]"
          class:stat-card-selected={detailOpen && detailStatKey === "sessionChars"}
          onclick={() => selectStat("sessionChars")}
        >
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Chars / Session</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{fmtChars($twSessionChars)}</span
          >
          <span class="stat-sub">per session</span>

          {#if periodData.bestChars !== undefined}
            <div class="stat-divider"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.bestCharsDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >best session</span
                >
                <span
                  class="font-substat-num text-sm leading-none tracking-widest text-black"
                  >{fmtChars(periodData.bestChars)}</span
                >
              </div>
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.worstCharsDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >worst session</span
                >
                <span
                  class="font-substat-num text-sm leading-none tracking-widest text-black"
                  >{fmtChars(periodData.worstChars)}</span
                >
              </div>
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="stat-card stat-card-highlight cursor-pointer transition-all hover:scale-[1.01]"
          class:stat-card-selected={detailOpen && detailStatKey === "sessionTime"}
          onclick={() => selectStat("sessionTime")}
        >
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Time / Session</span>
          <span class="stat-value stat-value-lg">{fmtTime($twSessionTime)}</span
          >
          <span class="stat-sub">per session</span>

          {#if periodData.bestTime !== undefined}
            <div class="stat-divider"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.bestTimeDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >best session</span
                >
                <span
                  class="font-substat-num text-sm leading-none tracking-widest text-black"
                  >{fmtTime(periodData.bestTime)}</span
                >
              </div>
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(periodData.worstTimeDate);
                }}
              >
                <span
                  class="font-substat-label text-[10px] uppercase tracking-wider text-black/60"
                  >worst session</span
                >
                <span
                  class="font-substat-num text-sm leading-none tracking-widest text-black"
                  >{fmtTime(periodData.worstTime)}</span
                >
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Detailed Statistics Accordion Toggle -->
      <button
        id="detailed-statistics"
        type="button"
        class="detail-toggle-btn group mt-4 flex w-full items-center justify-center gap-2 border-t border-dim py-3 text-xs font-semibold uppercase tracking-widest text-muted transition-all hover:text-accent cursor-pointer"
        onclick={() => (detailOpen = !detailOpen)}
      >
        <span>Detailed Statistics</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2.5"
          stroke="currentColor"
          class="h-3.5 w-3.5 transition-transform duration-300 group-hover:text-accent {detailOpen ? 'rotate-180' : ''}"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {#if detailOpen}
        <div class="detail-panel flex flex-col gap-6 pt-4 border-t border-dim" transition:slide={{ duration: 300 }}>
          <!-- Part 1: Chart section -->
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold uppercase tracking-wider text-title">
                  {STAT_CONFIG[detailStatKey].label} Over Time
                </span>
                <span class="text-xs text-muted">
                  • {periodData.totalLabel} (per {detailGranularity.toLowerCase()})
                </span>
              </div>

              <!-- Special sub-period toggle for Month / Custom / All Time -->
              {#if selectedPeriod === "Month" || selectedPeriod === "Custom"}
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-muted font-mono uppercase">Unit:</span>
                  <div class="flex items-center rounded bg-black/5 dark:bg-white/5 p-0.5 border border-dim">
                    {#if selectedPeriod === "Custom" && (periodData.spanDays || 0) > 60}
                      <button
                        type="button"
                        class="px-2 py-0.5 text-xs rounded transition-all cursor-pointer {monthSubPeriod === 'Month' ? 'bg-button text-white shadow-sm font-medium' : 'text-muted hover:text-strong'}"
                        onclick={() => (monthSubPeriod = 'Month')}
                      >
                        Per Month
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="px-2 py-0.5 text-xs rounded transition-all cursor-pointer {monthSubPeriod === 'Week' ? 'bg-button text-white shadow-sm font-medium' : 'text-muted hover:text-strong'}"
                      onclick={() => (monthSubPeriod = 'Week')}
                    >
                      Per Week
                    </button>
                    <button
                      type="button"
                      class="px-2 py-0.5 text-xs rounded transition-all cursor-pointer {monthSubPeriod === 'Day' ? 'bg-button text-white shadow-sm font-medium' : 'text-muted hover:text-strong'}"
                      onclick={() => (monthSubPeriod = 'Day')}
                    >
                      Per Day
                    </button>
                  </div>
                </div>
              {:else if selectedPeriod === "All Time"}
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-muted font-mono uppercase">Unit:</span>
                  <div class="flex items-center rounded bg-black/5 dark:bg-white/5 p-0.5 border border-dim">
                    <button
                      type="button"
                      class="px-2 py-0.5 text-xs rounded transition-all {allTimeSubPeriod === 'Year' ? 'bg-button text-white shadow-sm font-medium' : 'text-muted hover:text-strong'}"
                      onclick={() => (allTimeSubPeriod = 'Year')}
                    >
                      Per Year
                    </button>
                    <button
                      type="button"
                      class="px-2 py-0.5 text-xs rounded transition-all {allTimeSubPeriod === 'Month' ? 'bg-button text-white shadow-sm font-medium' : 'text-muted hover:text-strong'}"
                      onclick={() => (allTimeSubPeriod = 'Month')}
                    >
                      Per Month
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- SVG Line Chart with Dots & Area Fill -->
            <div class="detail-chart-wrap relative w-full pt-2" bind:clientWidth={chartWidth}>
              {#if detailBuckets.length > 0}
                {@const margin = { top: 15, right: 30, bottom: 40, left: 65 }}
                {@const innerW = Math.max(100, chartWidth - margin.left - margin.right)}
                {@const innerH = 175}
                {@const svgH = innerH + margin.top + margin.bottom}
                {@const maxV = max(detailBuckets, (d) => d.value) ?? 0}
                {@const yMax = maxV > 0 ? maxV * 1.15 : 10}
                {@const xSc = scalePoint<number>()
                  .domain(detailBuckets.map((_, i) => i))
                  .range([0, innerW])
                  .padding(detailBuckets.length === 1 ? 0.5 : 0.08)}
                {@const ySc = scaleLinear().domain([0, yMax]).range([innerH, 0])}
                {@const lineD = line<any>()
                  .x((_, i) => xSc(i) ?? 0)
                  .y((d) => ySc(d.value))
                  .curve(curveMonotoneX)(detailBuckets)}
                {@const areaD = area<any>()
                  .x((_, i) => xSc(i) ?? 0)
                  .y0(innerH)
                  .y1((d) => ySc(d.value))
                  .curve(curveMonotoneX)(detailBuckets)}
                {@const yTicks = ySc.ticks(4)}

                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <svg
                  width={chartWidth}
                  height={svgH}
                  role="img"
                  aria-label="Detailed statistics line chart"
                  class="overflow-visible select-none"
                  onmouseleave={() => (hoveredPointIndex = null)}
                >
                  <g transform="translate({margin.left}, {margin.top})">
                    <!-- Horizontal grid lines and Y-axis labels -->
                    {#each yTicks as t}
                      {@const yPos = ySc(t)}
                      <line
                        x1={0}
                        x2={innerW}
                        y1={yPos}
                        y2={yPos}
                        stroke="var(--exs-border)"
                        stroke-opacity="0.4"
                        stroke-dasharray="3 3"
                      />
                      <text
                        x={-10}
                        y={yPos}
                        fill="var(--exs-text-muted)"
                        font-size="10"
                        font-family="monospace"
                        text-anchor="end"
                        dominant-baseline="middle"
                      >
                        {formatYAxisTick(t, detailStatKey)}
                      </text>
                    {/each}

                    <!-- Baseline -->
                    <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--exs-border)" stroke-opacity="0.7" />

                    <!-- Area fill -->
                    {#if areaD && detailBuckets.length > 1}
                      <path d={areaD} fill="var(--exs-accent)" fill-opacity="0.12" />
                    {/if}

                    <!-- Line path -->
                    {#if lineD && detailBuckets.length > 1}
                      <path
                        d={lineD}
                        fill="none"
                        stroke="var(--exs-accent)"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    {/if}

                    <!-- Data points / dots: appear when hovering over the space for each duration -->
                    {#each detailBuckets as b, i}
                      {@const cx = xSc(i) ?? 0}
                      {@const cy = ySc(b.value)}
                      {@const isHovered = hoveredPointIndex === i}
                      {@const slice = (() => {
                        if (detailBuckets.length <= 1) {
                          const w = Math.min(innerW * 0.5, 200);
                          return { x: Math.max(0, cx - w / 2), w };
                        }
                        if (i === 0) {
                          const nextMid = ((xSc(0) ?? 0) + (xSc(1) ?? 0)) / 2;
                          return { x: 0, w: nextMid };
                        }
                        if (i === detailBuckets.length - 1) {
                          const prevMid = ((xSc(i - 1) ?? 0) + (xSc(i) ?? 0)) / 2;
                          return { x: prevMid, w: Math.max(0, innerW - prevMid) };
                        }
                        const prevMid = ((xSc(i - 1) ?? 0) + (xSc(i) ?? 0)) / 2;
                        const nextMid = ((xSc(i) ?? 0) + (xSc(i + 1) ?? 0)) / 2;
                        return { x: prevMid, w: Math.max(0, nextMid - prevMid) };
                      })()}
                      <!-- Invisible hover hit target spanning the duration's column space -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <rect
                        x={slice.x}
                        y={0}
                        width={slice.w}
                        height={innerH + 30}
                        fill="transparent"
                        class="cursor-pointer"
                        onmouseenter={() => (hoveredPointIndex = i)}
                      />

                      <!-- Dot: only visible when hovering over this duration's space -->
                      {#if isHovered}
                        <circle
                          {cx}
                          {cy}
                          r="6"
                          fill="var(--exs-accent)"
                          stroke="var(--exs-surface)"
                          stroke-width="2.5"
                          class="pointer-events-none drop-shadow"
                        />
                      {/if}

                      <!-- X axis labels -->
                      {@const step = detailBuckets.length > 20 ? Math.ceil(detailBuckets.length / 12) : 1}
                      {#if i % step === 0 || i === detailBuckets.length - 1}
                        <text
                          x={cx}
                          y={innerH + 20}
                          fill={isHovered ? "var(--exs-accent)" : "var(--exs-text-muted)"}
                          font-size="10"
                          font-family="sans-serif"
                          text-anchor="middle"
                          class="transition-colors"
                        >
                          {b.label}
                        </text>
                      {/if}
                    {/each}
                  </g>
                </svg>

                <!-- Hover tooltip card -->
                {#if hoveredPointIndex !== null && detailBuckets[hoveredPointIndex]}
                  {@const curB = detailBuckets[hoveredPointIndex]}
                  {@const curX = margin.left + (xSc(hoveredPointIndex) ?? 0)}
                  {@const curY = margin.top + ySc(curB.value)}
                  {@const tooltipLeft = Math.min(Math.max(10, curX - 90), chartWidth - 195)}
                  {@const tooltipTop = curY < 90 ? curY + 15 : curY - 85}
                  <div
                    class="absolute pointer-events-none z-30 rounded-lg p-2.5 shadow-xl border border-dim bg-surface text-strong text-xs"
                    style="left: {tooltipLeft}px; top: {tooltipTop}px; min-width: 175px;"
                  >
                    <div class="font-semibold text-strong border-b border-dim pb-1 mb-1.5 flex items-center justify-between">
                      <span>{curB.label}</span>
                      <span class="text-[10px] text-accent font-bold font-mono">
                        {STAT_CONFIG[detailStatKey].fmt(curB.value)}
                      </span>
                    </div>
                    <div class="space-y-0.5 text-[11px]">
                      {#if detailStatKey !== 'chars' && (detailGranularity === 'Day' ? detailStatKey !== 'sessionChars' : true)}
                        <div class="flex justify-between">
                          <span class="text-muted">Characters:</span>
                          <span class="font-mono font-medium">{fmtChars(curB.chars)}</span>
                        </div>
                      {/if}
                      {#if detailStatKey !== 'time' && (detailGranularity === 'Day' ? detailStatKey !== 'sessionTime' : true)}
                        <div class="flex justify-between">
                          <span class="text-muted">Time Read:</span>
                          <span class="font-mono font-medium">{fmtTime(curB.time)}</span>
                        </div>
                      {/if}
                      {#if detailStatKey !== 'speed'}
                        <div class="flex justify-between">
                          <span class="text-muted">Reading Speed:</span>
                          <span class="font-mono font-medium">{Math.round(curB.speed).toLocaleString()} /h</span>
                        </div>
                      {/if}
                      {#if detailGranularity !== 'Day'}
                        <div class="flex justify-between">
                          <span class="text-muted">Active Days:</span>
                          <span class="font-mono font-medium">{curB.activeDays}</span>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              {:else}
                <p class="py-8 text-center text-xs text-muted">No data available for this duration</p>
              {/if}
            </div>
          </div>

          <!-- Section Divider -->
          <div class="stat-divider"></div>

          <!-- Part 2: Top 5 Leaderboards (Best sessions, best weeks, best months) -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold uppercase tracking-wider text-title">
                Leaderboards
              </span>
              <span class="text-xs text-muted">
                • ranked by {STAT_CONFIG[detailStatKey].label.toLowerCase()}
              </span>
            </div>

            <!-- Leaderboard Cards Container -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <!-- Best Sessions Card -->
              <div class="best-list-card rounded-xl p-4 flex flex-col gap-2">
                <div class="flex items-center justify-between mb-1 pb-1 border-b border-dim/30">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-title flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                      <circle cx="12" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>
                    </svg>
                    Best Sessions
                  </h4>
                </div>
                <div class="flex flex-col gap-1.5">
                  {#each bestSessions as item, rank}
                    {@const primaryVal = (() => {
                      if (detailStatKey === 'chars' || detailStatKey === 'sessionChars') return fmtChars(item.chars);
                      if (detailStatKey === 'time' || detailStatKey === 'sessionTime') return fmtTime(item.time);
                      return `${Math.round(item.speed).toLocaleString()}/h`;
                    })()}
                    {@const isSelected = customHighlightStart === item.periodStart && customHighlightEnd === item.periodEnd}
                    <button
                      type="button"
                      class="leaderboard-row rank-{rank + 1} group"
                      class:leaderboard-row-selected={isSelected}
                      onclick={() => handleBestItemClick("session", item)}
                    >
                      <span class="lb-medal">
                        {#if rank < 3}
                          <svg class="lb-medal-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 2.5L12 12L9 12L4 2.5H7Z" class="medal-ribbon-l" />
                            <path d="M17 2.5L12 12L15 12L20 2.5H17Z" class="medal-ribbon-r" />
                            <circle cx="12" cy="16.5" r="5.5" class="medal-disc" />
                            <text x="12" y="18.8" font-size="6.5" font-weight="800" font-family="'Outfit', sans-serif" text-anchor="middle" fill="currentColor" stroke="none">{rank + 1}</text>
                          </svg>
                        {:else}
                          <span class="lb-rank-num">{rank + 1}</span>
                        {/if}
                      </span>
                      <div class="lb-body">
                        <span class="lb-label group-hover:text-accent transition-colors">{item.label}</span>
                        <span class="lb-secondary">{fmtChars(item.chars)} · {fmtTime(item.time)} · {Math.round(item.speed).toLocaleString()}/h</span>
                      </div>
                      <span class="lb-value">{primaryVal}</span>
                    </button>
                  {/each}
                  {#if bestSessions.length === 0}
                    <p class="text-xs text-muted text-center py-4">No session data available</p>
                  {/if}
                </div>
              </div>

              <!-- Best Weeks Card -->
              <div class="best-list-card rounded-xl p-4 flex flex-col gap-2">
                <div class="flex items-center justify-between mb-1 pb-1 border-b border-dim/30">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-title flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                      <path d="M7 15.5h10" stroke-width="2.5" stroke-linecap="round"/>
                    </svg>
                    Best Weeks
                  </h4>
                </div>
                <div class="flex flex-col gap-1.5">
                  {#each bestWeeks as item, rank}
                    {@const primaryVal = (() => {
                      if (detailStatKey === 'chars' || detailStatKey === 'sessionChars') return fmtChars(item.chars);
                      if (detailStatKey === 'time' || detailStatKey === 'sessionTime') return fmtTime(item.time);
                      return `${Math.round(item.speed).toLocaleString()}/h`;
                    })()}
                    {@const isSelected = customHighlightStart === item.periodStart && customHighlightEnd === item.periodEnd}
                    <button
                      type="button"
                      class="leaderboard-row rank-{rank + 1} group"
                      class:leaderboard-row-selected={isSelected}
                      onclick={() => handleBestItemClick("week", item)}
                    >
                      <span class="lb-medal">
                        {#if rank < 3}
                          <svg class="lb-medal-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 2.5L12 12L9 12L4 2.5H7Z" class="medal-ribbon-l" />
                            <path d="M17 2.5L12 12L15 12L20 2.5H17Z" class="medal-ribbon-r" />
                            <circle cx="12" cy="16.5" r="5.5" class="medal-disc" />
                            <text x="12" y="18.8" font-size="6.5" font-weight="800" font-family="'Outfit', sans-serif" text-anchor="middle" fill="currentColor" stroke="none">{rank + 1}</text>
                          </svg>
                        {:else}
                          <span class="lb-rank-num">{rank + 1}</span>
                        {/if}
                      </span>
                      <div class="lb-body">
                        <span class="lb-label group-hover:text-accent transition-colors">{item.label}</span>
                        <span class="lb-secondary">{fmtChars(item.chars)} · {fmtTime(item.time)} · {Math.round(item.speed).toLocaleString()}/h</span>
                      </div>
                      <span class="lb-value">{primaryVal}</span>
                    </button>
                  {/each}
                  {#if bestWeeks.length === 0}
                    <p class="text-xs text-muted text-center py-4">No week data available</p>
                  {/if}
                </div>
              </div>

              <!-- Best Months Card -->
              <div class="best-list-card rounded-xl p-4 flex flex-col gap-2">
                <div class="flex items-center justify-between mb-1 pb-1 border-b border-dim/30">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-title flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                      <path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>
                      <path d="M8 17.5h.01"/><path d="M12 17.5h.01"/><path d="M16 17.5h.01"/>
                    </svg>
                    Best Months
                  </h4>
                </div>
                <div class="flex flex-col gap-1.5">
                  {#each bestMonths as item, rank}
                    {@const primaryVal = (() => {
                      if (detailStatKey === 'chars' || detailStatKey === 'sessionChars') return fmtChars(item.chars);
                      if (detailStatKey === 'time' || detailStatKey === 'sessionTime') return fmtTime(item.time);
                      return `${Math.round(item.speed).toLocaleString()}/h`;
                    })()}
                    {@const isSelected = customHighlightStart === item.periodStart && customHighlightEnd === item.periodEnd}
                    <button
                      type="button"
                      class="leaderboard-row rank-{rank + 1} group"
                      class:leaderboard-row-selected={isSelected}
                      onclick={() => handleBestItemClick("month", item)}
                    >
                      <span class="lb-medal">
                        {#if rank < 3}
                          <svg class="lb-medal-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 2.5L12 12L9 12L4 2.5H7Z" class="medal-ribbon-l" />
                            <path d="M17 2.5L12 12L15 12L20 2.5H17Z" class="medal-ribbon-r" />
                            <circle cx="12" cy="16.5" r="5.5" class="medal-disc" />
                            <text x="12" y="18.8" font-size="6.5" font-weight="800" font-family="'Outfit', sans-serif" text-anchor="middle" fill="currentColor" stroke="none">{rank + 1}</text>
                          </svg>
                        {:else}
                          <span class="lb-rank-num">{rank + 1}</span>
                        {/if}
                      </span>
                      <div class="lb-body">
                        <span class="lb-label group-hover:text-accent transition-colors">{item.label}</span>
                        <span class="lb-secondary">{fmtChars(item.chars)} · {fmtTime(item.time)} · {Math.round(item.speed).toLocaleString()}/h</span>
                      </div>
                      <span class="lb-value">{primaryVal}</span>
                    </button>
                  {/each}
                  {#if bestMonths.length === 0}
                    <p class="text-xs text-muted text-center py-4">No month data available</p>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
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
      selectedGroup={legendSelectedGroup}
      onselect={(grp) => (legendSelectedGroup = grp)}
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
      onbarcontextmenu={handleBarContextMenu}
      hiddenCount={allGameNames.length - selectedGames.size}
      onresetvisibility={selectAllGames}
    />
  {:else}
    <div class="flex h-64 items-center justify-center">
      <p class="text-lg text-muted">
        No data to display{allGameNames.length > 0
          ? " — try adjusting filters"
          : ""}
      </p>
    </div>
  {/if}

  <!-- Bar Context Menu (derived from ContextMenu) -->
  <ContextMenu
    bind:show={barMenu.show}
    x={barMenu.x}
    y={barMenu.y}
    title={barMenu.gameName}
    onclose={closeBarMenu}
  >
    <button
      class="ctx-item ctx-item-danger"
      onclick={() => {
        toggleGame(barMenu.gameName);
        closeBarMenu();
      }}
    >
      <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
      <span>Hide Game</span>
    </button>
  </ContextMenu>

  <!-- Heatmap Day Context Menu (derived from ContextMenu) -->
  <ContextMenu
    bind:show={dayMenu.show}
    x={dayMenu.x}
    y={dayMenu.y}
    title={dayMenu.dateStr ? formatDate(parseISO(dayMenu.dateStr), "EEE, MMM d, yyyy") : undefined}
    minWidth="14rem"
    onclose={closeDayMenu}
  >
    {#snippet headerIcon()}
      <svg class="h-3.5 w-3.5 text-accent shrink-0 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    {/snippet}
    {#if selectedHeatmapDay && selectedHeatmapDay !== dayMenu.dateStr}
      <button
        class="ctx-item font-semibold text-accent"
        onclick={() => {
          applyCustomPeriod(selectedHeatmapDay, dayMenu.dateStr);
          closeDayMenu();
        }}
      >
        <svg class="h-3.5 w-3.5 text-accent shrink-0 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>Select to {formatDate(parseISO(dayMenu.dateStr), "MMM d")}</span>
      </button>
      <div class="ctx-divider"></div>
    {/if}
    {#if dayMenu.games.length === 0}
      <div class="px-3 py-2 text-xs text-muted">
        No games tracked
      </div>
    {:else if dayMenu.games.length === 1}
      {@const g = dayMenu.games[0]}
      <button
        class="ctx-item"
        onclick={() => handleAddCustomSession(dayMenu.dateStr, g)}
      >
        <svg class="h-3.5 w-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add Custom Session</span>
      </button>
      <button
        class="ctx-item"
        onclick={() => handleRecalculateSession(dayMenu.dateStr, g)}
      >
        <svg class="h-3.5 w-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
        <span>Recalculate</span>
      </button>
    {:else}
      <div class="ctx-section-title">
        <svg class="h-3 w-3 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add Custom Session:</span>
      </div>
      {#each dayMenu.games as g}
        <button
          class="ctx-item pl-5 truncate"
          onclick={() => handleAddCustomSession(dayMenu.dateStr, g)}
        >
          <span class="text-[10px] text-muted">•</span>
          <span class="truncate">{g.name}</span>
        </button>
      {/each}

      <div class="ctx-divider"></div>

      <div class="ctx-section-title">
        <svg class="h-3 w-3 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
        <span>Recalculate:</span>
      </div>
      {#each dayMenu.games as g}
        <button
          class="ctx-item pl-5 truncate"
          onclick={() => handleRecalculateSession(dayMenu.dateStr, g)}
        >
          <span class="text-[10px] text-muted">•</span>
          <span class="truncate">{g.name}</span>
        </button>
      {/each}
    {/if}
  </ContextMenu>

  <!-- Period Header Context Menu (derived from ContextMenu) -->
  <ContextMenu
    bind:show={periodMenu.show}
    x={periodMenu.x}
    y={periodMenu.y}
    title={periodMenu.period === "Custom" ? "Custom Range" : `Per ${periodMenu.period}`}
    minWidth="12rem"
    onclose={closePeriodMenu}
  >
    <button
      class="ctx-item justify-between"
      onclick={() => saveDefaultPeriod(periodMenu.period)}
    >
      <div class="flex items-center gap-2">
        <svg class="h-3.5 w-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>Save choice</span>
      </div>
      {#if savedDefaultPeriod === periodMenu.period}
        <svg class="h-3.5 w-3.5 text-emerald-400 shrink-0 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      {/if}
    </button>
  </ContextMenu>
</div>

<style global lang="postcss">
  @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100..700;1,100..700&family=Outfit:wght@100..900&display=swap");

  .font-substat-num {
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }

  .font-substat-label {
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  html,
  body {
    background: var(--exs-backdrop, #1e293b);
    color: var(--exs-text, #94a3b8);
    color-scheme: dark;
  }

  body.no-animations *,
  body.no-animations *::before,
  body.no-animations *::after {
    animation: none !important;
    transition: none !important;
  }

  #top_bar {
    background: color-mix(in srgb, var(--exs-backdrop) 85%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--exs-border, transparent);
  }

  .header-text {
    @apply inline-flex items-center text-4xl;
    color: var(--exs-title, #818cf8);
  }

  .header-icon {
    @apply h-full cursor-pointer;
    color: var(--exs-title, #818cf8);
  }
  .header-icon:hover {
    background: var(--exs-accent-hover, #4338ca);
    color: var(--exs-icon, #ffffff);
  }

  /* Utility classes */
  .text-strong {
    color: var(--exs-text-strong, #ffffff);
  }
  .text-sub {
    color: var(--exs-text, #94a3b8);
  }
  .text-muted {
    color: var(--exs-text-muted, #64748b);
  }
  .border-dim {
    border-color: var(--exs-border, #334155);
  }

  /* Toolbar buttons */
  .toolbar-btn {
    @apply cursor-pointer rounded px-3 py-1 text-sm;
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-menu-text, #d1d5db);
    border: 1px solid var(--exs-border, transparent);
    transition: all 0.15s ease;
  }
  .toolbar-btn:hover {
    background: var(--exs-accent, #818cf8);
    color: #ffffff;
  }
  .toolbar-btn-active {
    background: var(--exs-accent, #818cf8);
    color: #ffffff;
  }

  /* Panels */
  .panel {
    @apply rounded-lg p-4;
    background: var(--exs-block, #0f172a);
    border: 1px solid var(--exs-border, #334155);
  }
  .panel-sub {
    border-radius: 8px;
    border: 1px solid var(--exs-border, #334155);
    background: var(--exs-surface, #1e293b);
    padding: 1rem;
  }
  .panel-input {
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-text-strong, #ffffff);
    border: 1px solid var(--exs-border, transparent);
  }
  .panel-input:focus {
    border-color: var(--exs-accent, #818cf8);
    outline: none;
  }

  /* Small buttons */
  .btn-sm {
    @apply cursor-pointer rounded px-2 py-1 text-xs;
  }
  .btn-primary {
    background: var(--exs-btn-primary-bg, #4f46e5);
    color: var(--exs-btn-primary-text, #ffffff);
  }
  .btn-primary:hover {
    background: var(--exs-accent-hover, #4338ca);
  }
  .btn-secondary {
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-menu-text, #d1d5db);
    border: 1px solid var(--exs-border, transparent);
  }
  .btn-secondary:hover {
    background: var(--exs-border, #475569);
  }
  .btn-danger {
    @apply bg-red-600 text-white;
  }
  .btn-danger:hover {
    @apply bg-red-500;
  }
  .btn-danger-muted {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
  .btn-danger-muted:hover {
    background: rgba(239, 68, 68, 0.35);
  }
  .btn-restore {
    background: rgba(34, 197, 94, 0.2);
    color: #86efac;
  }
  .btn-restore:hover {
    background: rgba(34, 197, 94, 0.35);
  }

  /* Pills for filter */
  .pill {
    @apply flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm;
    transition: all 0.15s ease;
  }
  .pill-active {
    background: var(--exs-accent, #818cf8);
    color: var(--exs-accent-text, #ffffff);
  }
  .pill-inactive {
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-text-muted, #94a3b8);
    border: 1px solid var(--exs-border, transparent);
  }

  /* Game rows */
  .game-row {
    @apply flex items-center justify-between rounded px-3 py-2;
    background: var(--exs-surface, #1e293b);
    border: 1px solid var(--exs-border, transparent);
  }
  .game-row-deleted {
    border: 1px solid var(--exs-border, #334155);
    opacity: 0.6;
  }

  /* Type badge */
  .type-badge {
    @apply rounded px-1.5 py-0.5 uppercase;
    font-size: 10px;
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-text-muted, #9ca3af);
  }

  /* Rename input */
  .rename-input {
    @apply flex-1 rounded px-2 py-1 text-sm outline-none;
    background: var(--exs-menu-bg, #334155);
    color: var(--exs-text-strong, #ffffff);
    border: 1px solid var(--exs-accent, #818cf8);
  }

  /* Activity & Streak Section */
  .activity-section {
    background: var(--exs-chart-bg, #0f172a);
    border: 1px solid var(--exs-border, transparent);
    border-radius: 12px;
    box-shadow: var(--exs-section-shadow, none);
  }

  .streak-click-btn {
    outline: none;
    border-radius: 8px;
    padding: 4px 10px;
    transition: all 0.2s ease;
  }
  .streak-click-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--exs-accent);
  }
  .streak-click-btn.streak-selected {
    box-shadow: 0 0 0 2px var(--exs-accent);
    background: var(--exs-surface, rgba(255, 255, 255, 0.05));
  }

  /* Stat divider */
  .stat-divider {
    height: 1px;
    width: 100%;
    background-color: var(--exs-border, rgba(51, 65, 85, 0.5));
    margin: 0.75rem 0;
  }

  /* ---- Stat Cards ---- */
  .stats-wrap {
    background: var(--exs-chart-bg, #0f172a);
    border: 1px solid var(--exs-border, transparent);
    border-radius: 12px;
    padding: 16px 20px 14px;
    width: 100%;
    box-shadow: var(--exs-section-shadow, none);
  }
  .stats-title {
    text-align: center;
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--exs-title, #818cf8);
    margin: 0 0 4px;
    font-family: "Outfit", sans-serif;
  }

  .stats-tabs {
    display: flex;
    gap: 4px;
    justify-content: center;
    margin: 4px auto 12px;
    width: fit-content;
  }
  .stats-tab {
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 5px 16px;
    color: var(--exs-accent, #818cf8);
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
  }
  .stats-tab:hover {
    color: var(--exs-text-strong, #fff);
  }
  :global(.stats-tab-active) {
    background: var(--exs-accent, #818cf8) !important;
    color: var(--exs-accent-text, #ffffff) !important;
    font-weight: 500 !important;
  }

  .stats-section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0 8px;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--exs-title, #818cf8);
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco,
      Consolas, monospace;
  }
  .stats-line {
    flex: 1;
    height: 1px;
    background: var(--exs-border, #334155);
  }

  .stats-grid {
    display: grid;
    gap: 6px;
  }
  .stats-grid-3 {
    grid-template-columns: repeat(3, 1fr);
  }
  .stats-grid-5 {
    grid-template-columns: repeat(5, 1fr);
  }

  .stat-card {
    background: var(--exs-card-bg, #818cf8);
    border: none;
    border-radius: 8px;
    padding: 20px 24px 16px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    transition: transform 0.2s ease, filter 0.2s ease;
  }
  .stat-card:hover {
    filter: brightness(0.96);
  }
  .stat-card-highlight {
    border: none;
  }
  .stat-card-accent-bar {
    display: none;
  }

  .stat-label {
    font-size: 1.1rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--exs-card-text, #ffffff);
    opacity: 0.85;
    font-family: "Outfit", sans-serif;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 2.3rem;
    font-weight: 600;
    font-family: "Outfit", sans-serif;
    color: var(--exs-card-text, #ffffff);
    letter-spacing: -0.03em;
    line-height: 1;
    margin-bottom: 6px;
    transition: color 0.2s;
  }
  .stat-value-lg {
    font-size: 3rem;
  }
  .stat-value-accent {
    color: var(--exs-card-text, #ffffff);
  }

  .stat-sub {
    font-size: 1.1rem;
    color: var(--exs-card-text, #ffffff);
    opacity: 0.85;
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }

  /* Scoped substats inside .stat-card to match Tadoku button text styling */
  .stat-card :global(.font-substat-num) {
    color: var(--exs-card-text, #ffffff) !important;
  }
  .stat-card :global(.font-substat-label) {
    color: var(--exs-card-text, #ffffff) !important;
    opacity: 0.75;
  }
  .stat-card :global(.stat-divider) {
    background-color: color-mix(in srgb, var(--exs-card-text, #ffffff) 25%, transparent) !important;
  }
  .stat-card :global(.text-black\/40) {
    color: var(--exs-card-text, #ffffff) !important;
    opacity: 0.55;
  }
  .stat-card :global(.selected-game-title) {
    color: var(--exs-card-text, #ffffff) !important;
    opacity: 0.85;
    font-weight: 600;
  }
  .stat-card :global(.selected-game-title:hover) {
    opacity: 1;
    text-decoration: underline;
  }
  .stat-card :global(.hover\:bg-black\/5:hover) {
    background-color: color-mix(in srgb, var(--exs-card-text, #ffffff) 15%, transparent) !important;
  }
  .stat-card :global(.bg-black\/5) {
    background-color: color-mix(in srgb, var(--exs-card-text, #ffffff) 15%, transparent) !important;
    color: var(--exs-card-text, #ffffff) !important;
    opacity: 0.75;
  }

  .stat-card-selected {
    outline: 2px solid var(--exs-accent) !important;
    outline-offset: 2px !important;
  }

  .leaderboard-row-selected {
    border-color: var(--exs-accent) !important;
    box-shadow: 0 0 0 2px var(--exs-accent) !important;
  }

  .best-list-card {
    background: var(--exs-surface, #1e293b);
    border: 1px solid var(--exs-border, #334155);
  }

  /* ── Leaderboard cards / rows (Tadoku style with 3-tier hierarchy) ─ */
  .leaderboard-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    min-height: 52px;
    border-radius: 8px;
    background: var(--exs-block, #0f172a);
    border: 1px solid var(--exs-border-dim, #1e293b);
    text-align: left;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: transform 0.15s ease, filter 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .leaderboard-row:hover {
    transform: translateY(-1px);
    filter: brightness(1.08);
    border-color: var(--exs-border, #334155);
  }

  /* ── Unified Typography across all rows ── */
  .leaderboard-row .lb-label {
    color: var(--exs-text-strong);
  }
  .leaderboard-row .lb-secondary {
    font-size: 0.68rem;
    color: var(--exs-text-muted);
    font-weight: 500;
  }
  .leaderboard-row .lb-value {
    color: var(--exs-title);
  }

  /* ── Tier 1 (Rank 1 / Champion): Largest font hierarchy ── */
  .leaderboard-row.rank-1 .lb-label {
    font-size: 0.84rem;
    font-weight: 700;
  }
  .leaderboard-row.rank-1 .lb-value {
    font-size: 1.15rem;
    font-weight: 800;
  }
  .leaderboard-row.rank-1 .lb-medal-svg {
    width: 24px;
    height: 24px;
    color: var(--exs-title);
    filter: drop-shadow(0 1px 3px color-mix(in srgb, var(--exs-title) 35%, transparent));
  }

  /* ── Tier 2 (Rank 2 & 3 / Podium): Medium font hierarchy ── */
  .leaderboard-row.rank-2 .lb-label,
  .leaderboard-row.rank-3 .lb-label {
    font-size: 0.8rem;
    font-weight: 600;
  }
  .leaderboard-row.rank-2 .lb-value,
  .leaderboard-row.rank-3 .lb-value {
    font-size: 0.98rem;
    font-weight: 700;
  }
  .leaderboard-row.rank-2 .lb-medal-svg {
    width: 21px;
    height: 21px;
    color: color-mix(in srgb, var(--exs-title) 75%, var(--exs-text-strong));
  }
  .leaderboard-row.rank-3 .lb-medal-svg {
    width: 21px;
    height: 21px;
    color: color-mix(in srgb, var(--exs-title) 50%, var(--exs-text-muted));
  }

  /* ── Tier 3 (Rank 4 & 5 / Runners-up): Compact font hierarchy ── */
  .leaderboard-row.rank-4 .lb-label,
  .leaderboard-row.rank-5 .lb-label {
    font-size: 0.78rem;
    font-weight: 500;
  }
  .leaderboard-row.rank-4 .lb-value,
  .leaderboard-row.rank-5 .lb-value {
    font-size: 0.85rem;
    font-weight: 600;
  }

  /* ── Medal Container & Vector SVGs ────────────────────────── */
  .lb-medal {
    min-width: 1.8rem;
    height: 1.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .lb-medal-svg {
    display: block;
    overflow: visible;
  }
  .lb-medal-svg .medal-ribbon-l,
  .lb-medal-svg .medal-ribbon-r {
    fill: color-mix(in srgb, currentColor 22%, transparent);
    stroke: currentColor;
  }
  .lb-medal-svg .medal-disc {
    fill: color-mix(in srgb, currentColor 25%, var(--exs-block));
    stroke: currentColor;
  }

  .lb-rank-num {
    font-family: "Outfit", monospace;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--exs-text-muted);
  }

  .lb-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .lb-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lb-secondary {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lb-value {
    font-family: "Outfit", monospace;
    white-space: nowrap;
    flex-shrink: 0;
    text-align: right;
  }
</style>

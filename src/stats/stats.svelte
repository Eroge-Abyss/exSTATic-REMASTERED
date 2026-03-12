<script lang="ts">
  import BulkDataGraphs from "./bulk_data_graphs.svelte";
  import MediaGraphs from "./media_graphs.svelte";
  import CalendarHeatmap from "../components/charts/calendar_heatmap.svelte";
  import { fade } from "svelte/transition";
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";

  import { group, groups, sum, min, max } from "d3-array";
  import { format } from "d3-format";
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
    getYear,
  } from "date-fns";
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

  // ---- Game Filter ----
  let showFilterPanel = $state(false);
  let selectedGames = $state<Set<string>>(new Set());
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
  let allGameNames = $derived(
    Array.from(new Set(processedData.map((d) => d.name))).sort(),
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
          (d.name ?? "Unknown").trim(),
          { uuid: d.uuid, name: (d.name ?? "Unknown").trim(), type: d.type },
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
    syncReadingSummaryToGlobalYear(getYear(selectedYearStart));
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
    let bestStreak = 0;
    const uniqueDaySet = new Set(statsFilteredData.map((d) => d.date));
    if (uniqueDaySet.size > 0) {
      const sortedAsc = Array.from(uniqueDaySet)
        .map((d) => parseISO(d).getTime())
        .sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < sortedAsc.length; i++) {
        const diff = (sortedAsc[i] - sortedAsc[i - 1]) / 86400000;
        run = diff <= 1.1 ? run + 1 : 1;
        if (run > bestStreak) bestStreak = run;
      }
      if (sortedAsc.length === 1) bestStreak = 1;
      // current streak from the end
      const todayMs = new Date().setHours(0, 0, 0, 0);
      const lastDay = sortedAsc[sortedAsc.length - 1];
      if ((todayMs - lastDay) / 86400000 <= 1) {
        currentStreak = 1;
        let prev = lastDay;
        for (let i = sortedAsc.length - 2; i >= 0; i--) {
          if ((prev - sortedAsc[i]) / 86400000 <= 1.1) {
            currentStreak++;
            prev = sortedAsc[i];
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
      bestStreak,
      titlesRead: new Set(statsFilteredData.map((d) => d.name)).size,
    };
  });

  // Period tab state
  const PERIODS = ["Week", "Month", "Year", "All Time"] as const;
  let selectedPeriod = $state<(typeof PERIODS)[number]>("Week");
  let periodOffset = $state(0);

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

  // Reset offset when period changes
  $effect(() => {
    selectedPeriod;
    periodOffset = 0;
    charAvgIndex = 0;
    timeAvgIndex = 0;
    customHighlightStart = undefined;
    customHighlightEnd = undefined;
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
    if (uniqueDaySet.size === 0) return 0;
    const sortedAsc = Array.from(uniqueDaySet)
      .map((d) => parseISO(d).getTime())
      .sort((a, b) => a - b);
    let best = 1;
    let run = 1;
    for (let i = 1; i < sortedAsc.length; i++) {
      const diff = (sortedAsc[i] - sortedAsc[i - 1]) / 86400000;
      run = diff <= 1.1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
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
    if (selectedPeriod === "Week") {
      let weeklyData = statsBaseData.filter((d) => {
        const diff = differenceInDays(refDate, parseISO(d.date));
        return diff >= 0 && diff <= 6;
      });
      const activeDaysWeek = new Set(weeklyData.map((d) => d.date)).size;
      const totalChars = sum(weeklyData, (d) => d.chars_read) || 0;
      const totalTime = sum(weeklyData, (d) => d.time_read) || 0;
      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / 7),
        time: totalTime / 7,
        sessionChars:
          activeDaysWeek > 0 ? Math.round(totalChars / activeDaysWeek) : 0,
        sessionTime: activeDaysWeek > 0 ? totalTime / activeDaysWeek : 0,
        localActiveDays: activeDaysWeek,
        localBestStreak: getLocalStreak(weeklyData),
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

      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / computedSpan),
        time: totalTime / computedSpan,
        sessionChars:
          activeDaysMonth > 0 ? Math.round(totalChars / activeDaysMonth) : 0,
        sessionTime: activeDaysMonth > 0 ? totalTime / activeDaysMonth : 0,
        localActiveDays: activeDaysMonth,
        localBestStreak: getLocalStreak(monthlyData),
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

      return {
        avgSpeed:
          totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
        chars: Math.round(totalChars / computedSpan),
        time: totalTime / computedSpan,
        sessionChars:
          activeDaysYear > 0 ? Math.round(totalChars / activeDaysYear) : 0,
        sessionTime: activeDaysYear > 0 ? totalTime / activeDaysYear : 0,
        localActiveDays: activeDaysYear,
        localBestStreak: getLocalStreak(yearlyData),
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

    // All Time (fallback)
    let allData = statsBaseData;
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

    return {
      avgSpeed: totalTime > 0 ? Math.round((totalChars / totalTime) * 3600) : 0,
      chars: Math.round(totalChars / spanDays),
      time: totalTime / spanDays,
      sessionChars:
        activeDaysAll > 0 ? Math.round(totalChars / activeDaysAll) : 0,
      sessionTime: activeDaysAll > 0 ? totalTime / activeDaysAll : 0,
      localActiveDays: activeDaysAll,
      localBestStreak: getLocalStreak(allData),
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

  let activeSubPeriods = $derived.by(() => {
    if (selectedPeriod === "Week") return ["Day"];
    if (selectedPeriod === "Month") return ["Day", "Week"];
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
                <span class="truncate text-sm text-gray-200">{game.name}</span>
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
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span class="truncate text-sm text-gray-400 line-through"
                    >{game.name}</span
                  >
                  <span class="type-badge">{game.type}</span>
                  <span class="text-[10px] text-gray-600">
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
    </div>
  {/if}

  {#if filteredData.length > 0}
    <!-- Activity & Streak Section -->
    <div
      class="flex w-full flex-col items-center gap-6 rounded-xl bg-slate-900 p-8 shadow-lg shadow-black/20"
    >
      <div class="flex flex-row items-end justify-center gap-16">
        <div class="flex flex-col items-center">
          <span class="text-4xl font-bold text-gray-100"
            >{periodData.localActiveDays}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400"
            >Active Days</span
          >
        </div>
        <div class="flex flex-col items-center">
          <span class="text-4xl font-bold text-indigo-300"
            >{periodOffset === 0 && statCards.currentStreak > 0
              ? statCards.currentStreak
              : "—"}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400"
            >Current Streak</span
          >
        </div>
        <div class="flex flex-col items-center">
          <span class="text-4xl font-bold text-gray-400"
            >{periodData.localBestStreak > 0
              ? periodData.localBestStreak
              : "—"}</span
          >
          <span
            class="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400"
            >Best Streak</span
          >
        </div>
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
            onclick={() => (selectedPeriod = p)}
          >
            Per {p}
          </button>
        {/each}
      </div>

      <!-- Totals -->
      <div class="stats-section-header">
        <div class="stats-line"></div>
        <span>Totals</span>
        <div class="stats-nav">
          <button
            class="stats-nav-btn"
            onclick={() => changePeriodOffset(-1)}
            disabled={selectedPeriod === "All Time"}>◀</button
          >
          <span class="stats-nav-label">{periodData.totalLabel}</span>
          <button
            class="stats-nav-btn"
            onclick={() => changePeriodOffset(1)}
            disabled={selectedPeriod === "All Time" || periodOffset >= 0}
            >▶</button
          >
        </div>
        <div class="stats-line"></div>
      </div>
      <div class="stats-grid stats-grid-5">
        <div class="stat-card stat-card-highlight">
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Characters</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{fmtChars($twTotalChars)}</span
          >
          <span class="stat-sub">{periodData.totalLabel}</span>
          <span
            class="absolute bottom-4 right-4 text-right font-mono text-[10px] uppercase tracking-wide text-black/40"
            >{Math.round($twTotalTitles)} titles</span
          >

          {#if activeSubPeriods.length > 0}
            <div class="my-3 h-[1px] w-full bg-slate-700/50"></div>
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

        <div class="stat-card stat-card-highlight">
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Time Read</span>
          <span class="stat-value stat-value-lg">{fmtTime($twTotalTime)}</span>
          <span class="stat-sub">{periodData.totalLabel}</span>

          {#if activeSubPeriods.length > 0}
            <div class="my-3 h-[1px] w-full bg-slate-700/50"></div>
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

        <div class="stat-card stat-card-highlight">
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Reading Speed</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{Math.round($twAvgSpeed).toLocaleString()}</span
          >
          <span class="stat-sub">avg ch / hour</span>

          {#if periodData.bestSpeed !== undefined}
            <div class="my-3 h-[1px] w-full bg-slate-700/50"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={() => toggleHighlight(periodData.bestSpeedDate)}
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
                onclick={() => toggleHighlight(periodData.worstSpeedDate)}
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

        <div class="stat-card stat-card-highlight">
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Chars / Session</span>
          <span class="stat-value stat-value-lg stat-value-accent"
            >{fmtChars($twSessionChars)}</span
          >
          <span class="stat-sub">per session</span>

          {#if periodData.bestChars !== undefined}
            <div class="my-3 h-[1px] w-full bg-slate-700/50"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={() => toggleHighlight(periodData.bestCharsDate)}
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
                onclick={() => toggleHighlight(periodData.worstCharsDate)}
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

        <div class="stat-card stat-card-highlight">
          <div class="stat-card-accent-bar"></div>
          <span class="stat-label">Time / Session</span>
          <span class="stat-value stat-value-lg">{fmtTime($twSessionTime)}</span
          >
          <span class="stat-sub">per session</span>

          {#if periodData.bestTime !== undefined}
            <div class="my-3 h-[1px] w-full bg-slate-700/50"></div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex w-full flex-wrap gap-x-6 gap-y-2 text-sm">
              <div
                class="-m-1 flex cursor-pointer flex-col rounded p-1 transition-colors hover:bg-black/5"
                onclick={() => toggleHighlight(periodData.bestTimeDate)}
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
                onclick={() => toggleHighlight(periodData.worstTimeDate)}
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

  body {
    @apply bg-slate-800;
  }

  body.no-animations *,
  body.no-animations *::before,
  body.no-animations *::after {
    animation: none !important;
    transition: none !important;
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
    @apply cursor-pointer rounded bg-slate-700 px-3 py-1 text-sm text-gray-300;
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
    @apply cursor-pointer rounded px-2 py-1 text-xs;
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
    @apply flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm;
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
    @apply border border-slate-700 bg-opacity-50;
  }

  /* Type badge */
  .type-badge {
    @apply rounded bg-slate-700 px-1.5 py-0.5 uppercase;
    font-size: 10px;
    color: #9ca3af;
  }

  /* Rename input */
  .rename-input {
    @apply flex-1 rounded border border-indigo-500 bg-slate-700 px-2 py-1 text-sm text-white outline-none;
  }

  /* ---- Stat Cards ---- */
  .stats-wrap {
    background: #0f172a;
    border-radius: 12px;
    padding: 16px 20px 14px;
    width: 100%;
  }
  .stats-title {
    text-align: center;
    font-size: 1.3rem;
    font-weight: 700;
    color: #818cf8;
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
    color: #818cf8;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
  }
  .stats-tab:hover {
    color: #fff;
  }
  :global(.stats-tab-active) {
    background: #818cf8 !important;
    color: #fff !important;
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
    color: #818cf8;
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco,
      Consolas, monospace;
  }
  .stats-line {
    flex: 1;
    height: 1px;
    background: #3e36b4;
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
    background: #6d78d2;
    border: 1px solid #3e36b4;
    border-radius: 10px;
    padding: 20px 24px 16px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .stat-card-highlight {
    border-color: #4c1d95;
  }
  .stat-card-accent-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: #3e36b4;
  }

  .stat-label {
    font-size: 1.1rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: black;
    font-family: "Outfit", sans-serif;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 2.3rem;
    font-weight: 600;
    font-family: "Outfit", sans-serif;
    color: black;
    letter-spacing: -0.03em;
    line-height: 1;
    margin-bottom: 6px;
    transition: color 0.2s;
  }
  .stat-value-lg {
    font-size: 3rem;
  }
  .stat-value-accent {
    color: black;
  }

  .stat-sub {
    font-size: 1.1rem;
    color: black;
    font-family: "Outfit", sans-serif;
    font-weight: 500;
  }
</style>

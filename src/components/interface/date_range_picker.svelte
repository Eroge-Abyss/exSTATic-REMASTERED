<script lang="ts">
  import { onMount } from "svelte";
  import {
    format as formatDate,
    parseISO,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    getDay,
    addMonths,
    subMonths,
    subDays,
    addDays,
    startOfYear,
    endOfYear,
  } from "date-fns";

  interface Props {
    start?: string | null;
    end?: string | null;
    minDate?: string;
    maxDate?: string;
    onapply: (start: string, end: string) => void;
    onclose: () => void;
  }

  let {
    start = null,
    end = null,
    minDate,
    maxDate,
    onapply,
    onclose,
  }: Props = $props();

  let tempStart = $state<string>(start || formatDate(subDays(new Date(), 29), "yyyy-MM-dd"));
  let tempEnd = $state<string>(end || formatDate(new Date(), "yyyy-MM-dd"));

  function parseDateSafe(str?: string | null): Date {
    if (str) {
      try {
        const d = parseISO(str);
        if (!isNaN(d.getTime())) return d;
      } catch {
        // fallback
      }
    }
    return new Date();
  }

  // Currently viewed month in the calendar
  let viewDate = $state<Date>(parseDateSafe(end));

  let hoveredDate = $state<string | null>(null);
  let pickerRef = $state<HTMLDivElement | null>(null);

  // Month navigation
  function prevMonth() {
    viewDate = subMonths(viewDate, 1);
  }

  function nextMonth() {
    viewDate = addMonths(viewDate, 1);
  }

  // Month & Year Quick Jump + Today
  let showMonthPicker = $state(false);
  let pickerYear = $state(new Date().getFullYear());

  $effect(() => {
    pickerYear = viewDate.getFullYear();
  });

  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function selectMonth(monthIndex: number) {
    viewDate = new Date(pickerYear, monthIndex, 1);
    showMonthPicker = false;
  }

  function jumpToToday() {
    const today = new Date();
    const todayStr = formatDate(today, "yyyy-MM-dd");
    tempStart = todayStr;
    tempEnd = "";
    viewDate = today;
    pickerYear = today.getFullYear();
    showMonthPicker = false;
  }

  // Days in current view
  let calendarDays = $derived.by(() => {
    const mStart = startOfMonth(viewDate);
    const mEnd = endOfMonth(viewDate);
    const days = eachDayOfInterval({ start: mStart, end: mEnd });

    // Prefix empty slots for day-of-week alignment (Sunday = 0)
    const startDayOfWeek = getDay(mStart);
    const blanks = Array.from({ length: startDayOfWeek }, (_, i) => null);

    return {
      blanks,
      days,
      monthLabel: formatDate(viewDate, "MMMM yyyy"),
    };
  });

  // Handle day click
  function handleDayClick(dayStr: string) {
    if (!tempStart || (tempStart && tempEnd)) {
      // First click: set start, clear end
      tempStart = dayStr;
      tempEnd = "";
    } else if (tempStart && !tempEnd) {
      // Second click: set end
      if (dayStr < tempStart) {
        tempEnd = tempStart;
        tempStart = dayStr;
      } else {
        tempEnd = dayStr;
      }
    }
  }

  // Day offset input and expansion
  let offsetDays = $state<number>(7);

  function getAnchorDate(): Date {
    if (tempStart) {
      const d = parseDateSafe(tempStart);
      if (!isNaN(d.getTime())) return d;
    }
    if (tempEnd) {
      const d = parseDateSafe(tempEnd);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  function addDaysBefore() {
    const days = Math.max(1, offsetDays || 1);
    const anchor = tempEnd ? parseDateSafe(tempEnd) : getAnchorDate();
    const newStart = subDays(anchor, days);
    tempStart = formatDate(newStart, "yyyy-MM-dd");
    tempEnd = formatDate(anchor, "yyyy-MM-dd");
    viewDate = newStart;
  }

  function addDaysAfter() {
    const days = Math.max(1, offsetDays || 1);
    const anchor = tempStart ? parseDateSafe(tempStart) : getAnchorDate();
    const newEnd = addDays(anchor, days);
    tempStart = formatDate(anchor, "yyyy-MM-dd");
    tempEnd = formatDate(newEnd, "yyyy-MM-dd");
    viewDate = anchor;
  }

  function handleApply() {
    if (!tempStart) return;
    const finalEnd = tempEnd || tempStart;
    const [sortedStart, sortedEnd] =
      tempStart <= finalEnd ? [tempStart, finalEnd] : [finalEnd, tempStart];
    onapply(sortedStart, sortedEnd);
  }

  // Outside click & keyboard dismiss
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }

  function handleWindowPointer(e: MouseEvent) {
    if (pickerRef && !pickerRef.contains(e.target as Node)) {
      onclose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown, true);
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", handleWindowPointer);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("pointerdown", handleWindowPointer);
    };
  });
</script>

<!-- Date Range Picker Popover -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={pickerRef}
  class="date-range-popover absolute right-0 top-full mt-2 z-50 flex flex-col gap-3 rounded-xl p-4 shadow-2xl backdrop-blur-md"
  onclick={(e) => e.stopPropagation()}
>
  <!-- Header with title and close button -->
  <div class="flex items-center justify-between pb-2 border-b border-dim">
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span class="text-xs font-bold uppercase tracking-wider text-title">Custom Range</span>
    </div>
    <button
      type="button"
      class="rounded p-1 text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
      onclick={onclose}
      title="Close"
      aria-label="Close"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>

  <!-- Manual Date Inputs / Feedback -->
  <div class="flex items-center justify-between gap-2 text-xs">
    <div class="flex flex-col gap-1 flex-1">
      <span class="text-[10px] font-semibold uppercase text-muted">From</span>
      <input
        type="date"
        bind:value={tempStart}
        class="rounded-md px-2 py-1 text-xs border border-dim bg-backdrop text-strong outline-none focus:border-accent"
      />
    </div>
    <span class="text-muted mt-4">→</span>
    <div class="flex flex-col gap-1 flex-1">
      <span class="text-[10px] font-semibold uppercase text-muted">To</span>
      <input
        type="date"
        bind:value={tempEnd}
        min={tempStart}
        class="rounded-md px-2 py-1 text-xs border border-dim bg-backdrop text-strong outline-none focus:border-accent"
      />
    </div>
  </div>

  <!-- Days Offset Box (Add days before / after selected date) -->
  <div class="flex items-center justify-center gap-2 rounded-lg border border-dim bg-backdrop/70 px-3 py-1.5 text-xs">
    <button
      type="button"
      class="offset-arrow-btn"
      title="Span {offsetDays || 1} days before selected date"
      aria-label="Span {offsetDays || 1} days before selected date"
      onclick={addDaysBefore}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
    </button>

    <div class="offset-input-wrap">
      <input
        type="number"
        min="1"
        max="3650"
        bind:value={offsetDays}
        class="offset-input"
        placeholder="7"
      />
      <span class="offset-label">days</span>
    </div>

    <button
      type="button"
      class="offset-arrow-btn"
      title="Span {offsetDays || 1} days after selected date"
      aria-label="Span {offsetDays || 1} days after selected date"
      onclick={addDaysAfter}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </button>
  </div>

  <!-- Interactive Calendar Month Grid -->
  <div class="flex flex-col gap-1.5 rounded-lg border border-dim/50 bg-surface/50 p-2.5">
    <!-- Month Navigation -->
    <div class="flex items-center justify-between pb-1">
      <button
        type="button"
        class="rounded p-1 text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
        onclick={showMonthPicker ? () => pickerYear-- : prevMonth}
        title={showMonthPicker ? "Previous Year" : "Previous Month"}
        aria-label={showMonthPicker ? "Previous Year" : "Previous Month"}
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="text-xs font-semibold text-strong hover:text-accent transition-colors cursor-pointer flex items-center gap-1 bg-transparent border-0 p-0"
          onclick={() => (showMonthPicker = !showMonthPicker)}
          title="Click to jump month/year"
        >
          <span>{showMonthPicker ? pickerYear : calendarDays.monthLabel}</span>
          <svg class="h-2.5 w-2.5 transition-transform duration-200 {showMonthPicker ? 'rotate-180 text-accent' : 'text-muted'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        <button
          type="button"
          class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-surface hover:bg-hover text-muted hover:text-accent border border-dim transition-colors cursor-pointer"
          onclick={jumpToToday}
          title="Jump to today"
        >
          Today
        </button>
      </div>

      <button
        type="button"
        class="rounded p-1 text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
        onclick={showMonthPicker ? () => pickerYear++ : nextMonth}
        title={showMonthPicker ? "Next Year" : "Next Month"}
        aria-label={showMonthPicker ? "Next Year" : "Next Month"}
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </div>

    {#if showMonthPicker}
      <!-- 12-Month Quick Jump Grid -->
      <div class="grid grid-cols-3 gap-1.5 p-1 py-3 text-center">
        {#each MONTH_NAMES as mName, idx}
          {@const isCurrentMonth = viewDate.getFullYear() === pickerYear && viewDate.getMonth() === idx}
          <button
            type="button"
            class="rounded-md py-1.5 text-xs font-semibold transition-all cursor-pointer {isCurrentMonth ? 'bg-accent text-white shadow' : 'bg-surface hover:bg-hover text-strong border border-dim/40'}"
            onclick={() => selectMonth(idx)}
          >
            {mName}
          </button>
        {/each}
      </div>
    {:else}
      <!-- Day Headers: S M T W T F S -->
      <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted">
        <span>Su</span>
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
      </div>

      <!-- Days Grid -->
      <div class="grid grid-cols-7 gap-1 text-center">
        {#each calendarDays.blanks as _}
          <div class="h-7 w-7"></div>
        {/each}

        {#each calendarDays.days as day}
          {@const dayStr = formatDate(day, "yyyy-MM-dd")}
          {@const isStart = tempStart === dayStr}
          {@const isEnd = tempEnd === dayStr}
          {@const isInRange = (() => {
            if (tempStart && tempEnd) {
              return dayStr > tempStart && dayStr < tempEnd;
            }
            if (tempStart && !tempEnd && hoveredDate) {
              const [s, e] = tempStart <= hoveredDate ? [tempStart, hoveredDate] : [hoveredDate, tempStart];
              return dayStr > s && dayStr < e;
            }
            return false;
          })()}

          <button
            type="button"
            class="cal-day-btn h-7 w-7 rounded-md text-xs font-medium transition-all flex items-center justify-center cursor-pointer
              {isStart || isEnd
                ? 'bg-accent text-white font-bold shadow-sm'
                : isInRange
                  ? 'bg-accent/20 text-strong rounded-none'
                  : 'text-strong hover:bg-hover hover:text-white'}"
            style={isStart || isEnd ? 'color: var(--exs-accent-text, #ffffff);' : ''}
            onclick={() => handleDayClick(dayStr)}
            onmouseenter={() => (hoveredDate = dayStr)}
            onmouseleave={() => (hoveredDate = null)}
          >
            {formatDate(day, "d")}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Action Buttons -->
  <div class="flex items-center justify-end gap-2 pt-1 border-t border-dim">
    <button
      type="button"
      class="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
      onclick={onclose}
    >
      Cancel
    </button>
    <button
      type="button"
      class="rounded-lg px-4 py-1.5 text-xs font-semibold bg-button text-white shadow-sm hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer"
      style="color: var(--exs-accent-text, #ffffff);"
      disabled={!tempStart}
      onclick={handleApply}
    >
      Apply Range
    </button>
  </div>
</div>

<style>
  .date-range-popover {
    background: var(--exs-block, #0f172a);
    border: 1px solid var(--exs-border, #334155);
    width: 290px;
    user-select: none;
  }

  .offset-arrow-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--exs-surface, #1e293b);
    color: var(--exs-accent, #818cf8);
    border: 1px solid var(--exs-border-dim, #334155);
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .offset-arrow-btn:hover {
    background: var(--exs-hover, #334155);
    color: var(--exs-text-strong, #ffffff);
    border-color: var(--exs-accent, #818cf8);
  }

  .offset-input-wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--exs-surface, #1e293b);
    border: 1px solid var(--exs-border-dim, #334155);
    transition: border-color 0.15s ease;
  }

  .offset-input-wrap:focus-within {
    border-color: var(--exs-accent, #818cf8);
  }

  .offset-input {
    width: 32px;
    height: 22px;
    line-height: 22px;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    background: transparent !important;
    color: var(--exs-text-strong, #ffffff) !important;
    font-family: monospace;
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
    -moz-appearance: textfield;
  }

  .offset-input::-webkit-outer-spin-button,
  .offset-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .offset-input::placeholder {
    color: var(--exs-text-muted, #94a3b8);
    opacity: 0.6;
  }

  .offset-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--exs-text-muted, #94a3b8);
    user-select: none;
  }

  .text-strong {
    color: var(--exs-text-strong, #ffffff);
  }

  .cal-day-btn {
    border: none;
    outline: none;
  }
</style>

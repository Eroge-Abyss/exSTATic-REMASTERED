<script lang="ts">
  import type { Stat } from "../../storage/instance_storage";
  import type { MediaStorage } from "../../storage/media_storage";

  let SECS_TO_HOURS = 60 * 60;

  interface Props {
    media_storage: MediaStorage;
    active?: boolean;
    show_lines?: boolean;
    collapsed?: boolean;
    children?: import("svelte").Snippet;
  }

  let {
    media_storage,
    active = $bindable(false),
    show_lines = true,
    collapsed = false,
    children,
  }: Props = $props();

  let chars: string = $state("0");
  let lines: string = $state("0");
  let time: string = $state("00:00:00");
  let speed: string = $state("0");

  const getStat = (daily_stats: Stat | undefined, stat_key: keyof Stat) =>
    daily_stats != undefined && daily_stats.hasOwnProperty(stat_key)
      ? daily_stats[stat_key]
      : 0;

  const getTime = (time_secs: number) => {
    if (!time_secs || isNaN(time_secs) || time_secs < 0 || !isFinite(time_secs)) {
      return "00:00:00";
    }
    const totalSecs = Math.round(time_secs);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getSpeed = (
    chars: number | undefined,
    time_secs: number | undefined,
  ) =>
    chars === undefined ||
    time_secs === undefined ||
    isNaN(chars) ||
    isNaN(time_secs) ||
    chars === 0 ||
    time_secs === 0
      ? (0).toLocaleString()
      : Math.round((chars / time_secs) * SECS_TO_HOURS).toLocaleString();

  const calculateStats = () => {
    const daily_stats = media_storage.instance_storage?.today_stats;

    const char_count = getStat(daily_stats, "chars_read");
    const time_secs = getStat(daily_stats, "time_read");

    chars = char_count?.toLocaleString() ?? "";
    time = getTime(time_secs!);
    speed = getSpeed(char_count, time_secs);

    if (show_lines) {
      const line_count = getStat(daily_stats, "lines_read");
      lines = line_count?.toLocaleString() ?? "";
    }
  };
  calculateStats();

  document.addEventListener("status_active", () => {
    active = true;
    calculateStats();
  });
  document.addEventListener("status_inactive", () => {
    active = false;
    calculateStats();
  });
</script>

<div
  class="menu-bar z-50 flex flex-row items-center text-black {collapsed ? 'collapsed' : 'h-full'}"
  style="color: #000000;"
>
  <div
    class="stats-content flex flex-row items-center gap-3 overflow-hidden whitespace-nowrap {collapsed ? 'collapsed' : ''}"
  >
    <div id="chars_read" class="stat-numbers">{chars}</div>
    <div class="stat-annotation">Chars</div>
    <span class="material-icons">auto_stories</span>

    {#if show_lines}
      <div id="lines_read" class="stat-numbers">{lines}</div>
      <div class="stat-annotation">Lines</div>
      <span class="material-icons">drive_file_rename_outline</span>
    {/if}

    <div id="elapsed_time" class="stat-numbers">{time}</div>
    <div class="stat-annotation">Elapsed</div>
    <span class="material-icons">timer</span>

    <div id="chars_per_hour" class="stat-numbers">{speed}</div>
    <div class="stat-annotation">Chars / Hour</div>

    <span id="activity_symbol" class="material-icons">
      {#if active}
        hourglass_bottom
      {:else}
        bedtime
      {/if}
    </span>
  </div>

  {@render children?.()}
</div>

<style>
  .stats-content {
    max-width: 1200px;
    opacity: 1;
    min-width: 0;
    transition: max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin 0.35s ease;
  }

  .stats-content.collapsed {
    max-width: 0 !important;
    width: 0 !important;
    min-width: 0 !important;
    opacity: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    pointer-events: none !important;
  }

  .stat-numbers {
    font-family: "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas",
      "Liberation Mono", "Courier New", "monospace";
    font-size: 1rem;
    line-height: 1.5rem;
    white-space: nowrap;
  }

  .stat-annotation {
    font-size: 0.75rem;
    line-height: 1rem;
    letter-spacing: -0.05em;
    white-space: nowrap;
  }
</style>

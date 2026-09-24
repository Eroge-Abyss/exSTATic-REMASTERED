<script lang="ts">
  import MenuOption from "../components/interface/menu_option.svelte";
  import SettingRow from "../components/interface/setting_row.svelte";
  import type { MokuroStorage } from "../mokuro/mokuro_storage";
  import type { TTUStorage } from "../ttu/ttu_storage";
  import { VNStorage } from "../vn/vn_storage";
  import * as browser from "webextension-polyfill";
  import { onMount } from "svelte";
  import { applyTheme, setTheme } from "../themes/apply_theme";
  import { themeList, type ThemeId } from "../themes/themes";
  import { exportLines, exportStats } from "../data_wrangling/data_export";
  import { importLines, importStats } from "../data_wrangling/data_import";
  import type { DataEntry } from "../data_wrangling/data_extraction";
  import { parse } from "papaparse";

  let type = $state("global");
  let disableAnimations = $state(false);
  let showTexthookerWs = $state(true);
  let showTadokuWs = $state(true);
  let muramasaLogging = $state(false);
  let tadokuLogging = $state(false);
  let tadokuAutoJoinContest = $state(true);
  let tadokuManualLogging = $state(false);
  let tadokuAuthStatus = $state<{
    checked: boolean;
    loggedIn: boolean;
    displayName?: string;
    role?: string;
  }>({
    checked: false,
    loggedIn: false,
  });
  let lastDayResetDate = $state<string | null>(null);
  let lastDayResetCount = $state<number>(0);
  let tadokuContestInfo = $state<{
    checked: boolean;
    active: boolean;
    title?: string;
    registered?: boolean;
  }>({
    checked: false,
    active: false,
  });

  const refreshSyncStats = async () => {
    const data = await browser.storage.local.get([
      "tadoku_last_day_reset_processed",
      "tadoku_pushed_records",
    ]);
    lastDayResetDate = data.tadoku_last_day_reset_processed ?? null;
    const pushed = data.tadoku_pushed_records ?? {};
    if (lastDayResetDate) {
      lastDayResetCount = Object.keys(pushed).filter((k) => k.endsWith(`_${lastDayResetDate}`)).length;
    }
  };

  const checkTadokuContestInfo = async () => {
    try {
      const res = await browser.runtime.sendMessage({ action: "tadoku_contest_info" });
      if (res) {
        tadokuContestInfo = {
          checked: true,
          active: !!res.active,
          title: res.title,
          registered: !!res.registered,
        };
      }
    } catch {
      tadokuContestInfo = { checked: true, active: false };
    }
  };

  const checkTadokuStatus = async () => {
    try {
      const res = await browser.runtime.sendMessage({ action: "tadoku_status" });
      if (res && res.loggedIn) {
        tadokuAuthStatus = {
          checked: true,
          loggedIn: true,
          displayName: res.user?.displayName || "Tadoku User",
          role: res.role,
        };
      } else {
        tadokuAuthStatus = {
          checked: true,
          loggedIn: false,
        };
      }
    } catch {
      tadokuAuthStatus = {
        checked: true,
        loggedIn: false,
      };
    }
  };

  const toggleTadokuLogging = async () => {
    tadokuLogging = !tadokuLogging;
    await browser.storage.local.set({
      tadoku_logging: tadokuLogging,
    });
    if (tadokuLogging) {
      checkTadokuStatus();
      checkTadokuContestInfo();
      refreshSyncStats();
    }
  };

  const toggleTadokuAutoJoin = async () => {
    tadokuAutoJoinContest = !tadokuAutoJoinContest;
    await browser.storage.local.set({
      tadoku_auto_join_contest: tadokuAutoJoinContest,
    });
  };

  const toggleTadokuManualLogging = async () => {
    tadokuManualLogging = !tadokuManualLogging;
    await browser.storage.local.set({
      tadoku_manual_logging: tadokuManualLogging,
    });
  };

  const openTadokuLogin = async () => {
    await browser.runtime.sendMessage({
      action: "open_tab",
      url: "https://tadoku.app",
    });
  };

  let currentTheme = $state<ThemeId>("dark");
  let selectedTheme = $derived(themeList.find((t) => t.id === currentTheme));
  let isThemeDropdownOpen = $state(false);
  let dropdownRef: HTMLDivElement | undefined = $state();

  const handleClickOutside = (event: MouseEvent) => {
    if (isThemeDropdownOpen && dropdownRef && !dropdownRef.contains(event.target as Node)) {
      isThemeDropdownOpen = false;
    }
  };

  onMount(async () => {
    currentTheme = await applyTheme();
    const data = await browser.storage.local.get([
      "disable_animations",
      "show_texthooker_ws",
      "show_tadoku_ws",
      "show_websocket_icons",
      "muramasa_logging",
      "tadoku_logging",
      "tadoku_auto_join_contest",
      "tadoku_manual_logging",
      "tadoku_last_day_reset_processed",
      "tadoku_pushed_records",
    ]);
    disableAnimations = !!data.disable_animations;
    showTexthookerWs =
      data.show_texthooker_ws !== undefined
        ? !!data.show_texthooker_ws
        : (data.show_websocket_icons !== undefined ? !!data.show_websocket_icons : true);
    showTadokuWs =
      data.show_tadoku_ws !== undefined
        ? !!data.show_tadoku_ws
        : (data.show_websocket_icons !== undefined ? !!data.show_websocket_icons : true);
    muramasaLogging = !!data.muramasa_logging;
    tadokuLogging = !!data.tadoku_logging;
    tadokuAutoJoinContest = data.tadoku_auto_join_contest !== false;
    tadokuManualLogging = !!data.tadoku_manual_logging;
    lastDayResetDate = data.tadoku_last_day_reset_processed ?? null;
    const pushed = data.tadoku_pushed_records ?? {};
    if (lastDayResetDate) {
      lastDayResetCount = Object.keys(pushed).filter((k) => k.endsWith(`_${lastDayResetDate}`)).length;
    }
    if (tadokuLogging) {
      checkTadokuStatus();
      checkTadokuContestInfo();
    }
    const handleFocus = () => {
      if (tadokuLogging) {
        checkTadokuStatus();
        checkTadokuContestInfo();
        refreshSyncStats();
      }
    };
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("focus", handleFocus);
    };
  });

  const toggleAnimations = async () => {
    disableAnimations = !disableAnimations;
    await browser.storage.local.set({ disable_animations: disableAnimations });
  };

  const toggleTexthookerWs = async () => {
    showTexthookerWs = !showTexthookerWs;
    await browser.storage.local.set({
      show_texthooker_ws: showTexthookerWs,
    });
  };

  const toggleTadokuWs = async () => {
    showTadokuWs = !showTadokuWs;
    await browser.storage.local.set({
      show_tadoku_ws: showTadokuWs,
    });
  };

  const toggleMuramasaLogging = async () => {
    muramasaLogging = !muramasaLogging;
    await browser.storage.local.set({
      muramasa_logging: muramasaLogging,
    });
  };

  const handleThemeChange = async (newTheme: ThemeId) => {
    currentTheme = newTheme;
    await setTheme(newTheme);
  };

  let statsFileInput: HTMLInputElement | undefined = $state();
  let linesFileInput: HTMLInputElement | undefined = $state();

  const requestExportLines = async () => {
    const confirmed = confirm(
      "Are you sure you'd like to export lines?\nExporting large numbers of lines can take a long time, please wait and do not retry whilst the operation takes place...",
    );

    if (confirmed) {
      await exportLines();
    }
  };

  const requestImportStats = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const confirmed = confirm(
      "Are you sure you'd like to import stats?\nThe imported stats will replace conflicting entries (i.e. on the same days for the same media)...\nIt is highly recommended to BACKUP (export) data regularly in case anything goes wrong (i.e. before importing)!",
    );

    if (!confirmed) {
      (event.target as HTMLInputElement).value = "";
      return;
    }

    parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (result) => {
        await importStats(result.data as DataEntry[]);
        alert(
          "Finished importing stats successfully!\nPlease refresh all exSTATic pages now...",
        );
        (event.target as HTMLInputElement).value = "";
      },
    });
  };

  const requestImportLines = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const confirmed = confirm(
      "Are you sure you'd like to import lines?\n Please ensure that ALL stats are up to date beforehand (import if necessary).\nThe imported lines will be inserted after the current ones in storage...\nIt is highly recommended to BACKUP (export) data regularly in case anything goes wrong (i.e. before importing)!",
    );

    if (!confirmed) {
      (event.target as HTMLInputElement).value = "";
      return;
    }

    parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (result) => {
        await importLines(result.data as { [key: string]: string | number }[]);
        alert(
          "Finished importing lines successfully!\nPlease refresh all exSTATic pages now...",
        );
        (event.target as HTMLInputElement).value = "";
      },
    });
  };

  interface Props {
    vn_storage: VNStorage;
    mokuro_storage: MokuroStorage;
    ttu_storage: TTUStorage;
  }

  let { vn_storage, mokuro_storage, ttu_storage }: Props = $props();
</script>

<div class="flex flex-col gap-10 px-20">
  <div
    id="top_bar"
    class="sticky top-0 z-50 flex flex-col items-center justify-center py-4 gap-2.5"
  >
    <p class="header-text">Settings</p>
    <div class="flex items-center gap-1 rounded-lg bg-block p-1 border border-dim shadow-sm">
      {#each [
        { id: 'global', label: 'Global Dash' },
        { id: 'vn', label: 'VN' },
        { id: 'mokuro', label: 'Mokuro' },
        { id: 'ttu', label: 'TTU' }
      ] as tab}
        <button
          type="button"
          class="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer {type === tab.id
            ? 'bg-button text-white shadow-sm'
            : 'text-text hover:text-white hover:bg-hover/50'}"
          onclick={() => (type = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  </div>
</div>

<div class="absolute left-0 right-0 z-50 grid grid-cols-2 p-5">
  {#if type === "vn"}
    <MenuOption
      media_storage={vn_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="60"
    />
    <MenuOption
      media_storage={vn_storage}
      id="inactivity_blur"
      description="Inactivity Blur"
      units="px"
      value="2"
    />
    <MenuOption
      media_storage={vn_storage}
      id="menu_blur"
      description="Menu Blur"
      units="px"
      value="8"
      root_css="--default-menu-blur"
    />
    <MenuOption
      media_storage={vn_storage}
      id="font"
      description="Font"
      type="text"
      value="Klee One"
      root_css="--default-font"
    />
    <MenuOption
      media_storage={vn_storage}
      id="font_size"
      description="Font Size"
      units="rem"
      value="2"
      root_css="--default-font-size"
    />
    <MenuOption
      media_storage={vn_storage}
      id="bottom_line_padding"
      description="Bottom Pushback"
      units="%"
      value="20"
      root_css="--default-text-align"
    />
    <MenuOption
      media_storage={vn_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="60"
    />
    <MenuOption
      media_storage={vn_storage}
      id="max_loaded_lines"
      description="Max Loaded Lines"
      units="UI"
      value="5000"
    />
    <MenuOption
      media_storage={vn_storage}
      id="inactivity_blur"
      description="Inactivity Blur"
      units="px"
      value="2"
    />
    <MenuOption
      media_storage={vn_storage}
      id="menu_blur"
      description="Menu Blur"
      units="px"
      value="8"
      root_css="--default-menu-blur"
    />
    <SettingRow label="Muramasa Bot Logging">
      <button
        type="button"
        class="rounded-lg px-6 py-2 font-medium transition-colors cursor-pointer {muramasaLogging
          ? 'bg-button text-white hover:bg-hover'
          : 'bg-backdrop text-text hover:opacity-80'}"
        onclick={toggleMuramasaLogging}
      >
        {muramasaLogging ? "ON (Enabled)" : "OFF (Disabled)"}
      </button>
    </SettingRow>
    <SettingRow label="Tadoku.app Integration">
      <button
        type="button"
        class="rounded-lg px-6 py-2 font-medium transition-colors cursor-pointer {tadokuLogging
          ? 'bg-button text-white hover:bg-hover'
          : 'bg-backdrop text-text hover:opacity-80'}"
        onclick={toggleTadokuLogging}
      >
        {tadokuLogging ? "ON (Enabled)" : "OFF (Disabled)"}
      </button>
    </SettingRow>
    {#if tadokuLogging}
      <SettingRow label="Tadoku Connection">
        <div class="flex items-center gap-2">
          {#if !tadokuAuthStatus.checked}
            <span class="text-xs text-muted">Checking connection...</span>
          {:else if tadokuAuthStatus.loggedIn}
            <span class="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
              Logged in as {tadokuAuthStatus.displayName}
            </span>
          {:else}
            <span class="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
              <span class="h-2 w-2 rounded-full bg-amber-400"></span>
              Not logged in
            </span>
            <button
              type="button"
              class="text-xs text-accent underline hover:opacity-80 cursor-pointer ml-1"
              onclick={openTadokuLogin}
            >
              Log in to Tadoku
            </button>
          {/if}
          <button
            type="button"
            class="text-xs text-muted hover:text-text cursor-pointer ml-1 px-1.5 py-0.5 rounded bg-surface hover:bg-hover transition-colors"
            title="Refresh status"
            onclick={() => {
              checkTadokuStatus();
              checkTadokuContestInfo();
              refreshSyncStats();
            }}
          >
            ↻
          </button>
        </div>
      </SettingRow>
      {#if lastDayResetDate}
        <SettingRow label="Last Automatic Sync">
          <span class="text-xs text-text">
            {lastDayResetDate} &bull; {lastDayResetCount > 0 ? `${lastDayResetCount} visual novel${lastDayResetCount === 1 ? '' : 's'} logged` : 'No reading to log'}
          </span>
        </SettingRow>
      {/if}
      <SettingRow label="Auto-join Official Contests">
        <div class="flex items-center gap-3">
          {#if tadokuContestInfo.checked}
            {#if tadokuContestInfo.active && tadokuContestInfo.title}
              <span class="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                Active: {tadokuContestInfo.title} {tadokuContestInfo.registered ? '(Japanese registered)' : ''}
              </span>
            {:else}
              <span class="text-xs text-muted">No active official contest</span>
            {/if}
          {/if}
          <button
            type="button"
            class="rounded-lg px-6 py-2 font-medium transition-colors cursor-pointer {tadokuAutoJoinContest
              ? 'bg-button text-white hover:bg-hover'
              : 'bg-backdrop text-text hover:opacity-80'}"
            onclick={toggleTadokuAutoJoin}
          >
            {tadokuAutoJoinContest ? "ON (Enabled)" : "OFF (Disabled)"}
          </button>
        </div>
      </SettingRow>
      <SettingRow label="Manual Logging">
        <button
          type="button"
          class="rounded-lg px-6 py-2 font-medium transition-colors cursor-pointer {tadokuManualLogging
            ? 'bg-button text-white hover:bg-hover'
            : 'bg-backdrop text-text hover:opacity-80'}"
          onclick={toggleTadokuManualLogging}
        >
          {tadokuManualLogging ? "ON (Enabled)" : "OFF (Disabled)"}
        </button>
      </SettingRow>
    {/if}
  {:else if type === "mokuro"}
    <MenuOption
      media_storage={mokuro_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="120"
    />
  {:else if type === "ttu"}
    <MenuOption
      media_storage={ttu_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="120"
    />
  {:else if type === "global"}
    <SettingRow label="Theme">
      <div class="relative" bind:this={dropdownRef}>
        <button
          type="button"
          class="flex items-center gap-3 rounded-lg bg-backdrop px-4 py-2.5 text-sm font-medium text-text border border-dim shadow-sm transition-all hover:text-white hover:border-accent min-w-[210px] justify-between cursor-pointer"
          onclick={(e) => {
            e.stopPropagation();
            isThemeDropdownOpen = !isThemeDropdownOpen;
          }}
          aria-expanded={isThemeDropdownOpen}
        >
          <div class="flex items-center gap-2.5">
            {#if selectedTheme}
              <span
                class="inline-block h-4 w-4 rounded-full border shadow-sm flex-shrink-0"
                style="background: linear-gradient(135deg, {selectedTheme.background} 50%, {selectedTheme.primary} 50%); border-color: {selectedTheme.accent};"
              ></span>
              <span class="text-white font-semibold">{selectedTheme.name}</span>
            {/if}
          </div>
          <svg
            class="h-4 w-4 text-muted transition-transform duration-200 {isThemeDropdownOpen ? 'rotate-180' : ''}"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if isThemeDropdownOpen}
          <div
            class="absolute right-0 top-full mt-2 w-56 rounded-xl border shadow-2xl z-50 py-1.5 max-h-80 overflow-y-auto backdrop-blur-md"
            style="background: var(--exs-block, #0f172a); border-color: var(--exs-border, #334155);"
          >
            {#each themeList as theme}
              <button
                type="button"
                class="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-medium transition-colors text-left cursor-pointer {currentTheme === theme.id
                  ? 'bg-button text-white font-semibold'
                  : 'text-text hover:bg-hover hover:text-white'}"
                style={currentTheme === theme.id ? 'color: var(--exs-accent-text, #ffffff);' : ''}
                onclick={() => {
                  handleThemeChange(theme.id);
                  isThemeDropdownOpen = false;
                }}
              >
                <div class="flex items-center gap-2.5">
                  <span
                    class="inline-block h-3.5 w-3.5 rounded-full border shadow-sm flex-shrink-0"
                    style="background: linear-gradient(135deg, {theme.background} 50%, {theme.primary} 50%); border-color: {theme.accent};"
                  ></span>
                  <span>{theme.name}</span>
                </div>
                {#if currentTheme === theme.id}
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </SettingRow>

    <SettingRow label="Disable Dashboard Animations">
      <button
        class="rounded-lg px-6 py-2 font-medium transition-colors {disableAnimations
          ? 'bg-button text-white hover:bg-hover'
          : 'bg-backdrop text-text hover:opacity-80'}"
        onclick={toggleAnimations}
      >
        {disableAnimations
          ? "ON (Animations Disabled)"
          : "OFF (Animations Enabled)"}
      </button>
    </SettingRow>

    <SettingRow label="Tracker WebSocket Icons" inputClass="gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all cursor-pointer {showTexthookerWs
          ? 'bg-button text-white shadow-sm hover:bg-hover'
          : 'bg-backdrop text-text opacity-40 hover:opacity-70'}"
        onclick={toggleTexthookerWs}
        title={showTexthookerWs ? "Texthooker: visible (click to hide)" : "Texthooker: hidden (click to show)"}
      >
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.4 7.5C22.2 8.3 22.2 9.6 21.4 10.3L18.6 13.1L10.8 5.3L13.6 2.5C14.4 1.7 15.7 1.7 16.4 2.5L18.2 4.3L21.2 1.3L22.6 2.7L19.6 5.7L21.4 7.5M15.6 13.3L14.2 11.9L11.4 14.7L9.3 12.6L12.1 9.8L10.7 8.4L7.9 11.2L6.4 9.8L3.6 12.6C2.8 13.4 2.8 14.7 3.6 15.4L5.4 17.2L1.4 21.2L2.8 22.6L6.8 18.6L8.6 20.4C9.4 21.2 10.7 21.2 11.4 20.4L14.2 17.6L12.8 16.2L15.6 13.3Z" />
        </svg>
        <span>Texthooker</span>
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all cursor-pointer {showTadokuWs
          ? 'bg-button text-white shadow-sm hover:bg-hover'
          : 'bg-backdrop text-text opacity-40 hover:opacity-70'}"
        onclick={toggleTadokuWs}
        title={showTadokuWs ? "Tadoku: visible (click to hide)" : "Tadoku: hidden (click to show)"}
      >
        <span class="relative inline-flex items-center">
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.4 7.5C22.2 8.3 22.2 9.6 21.4 10.3L18.6 13.1L10.8 5.3L13.6 2.5C14.4 1.7 15.7 1.7 16.4 2.5L18.2 4.3L21.2 1.3L22.6 2.7L19.6 5.7L21.4 7.5M15.6 13.3L14.2 11.9L11.4 14.7L9.3 12.6L12.1 9.8L10.7 8.4L7.9 11.2L6.4 9.8L3.6 12.6C2.8 13.4 2.8 14.7 3.6 15.4L5.4 17.2L1.4 21.2L2.8 22.6L6.8 18.6L8.6 20.4C9.4 21.2 10.7 21.2 11.4 20.4L14.2 17.6L12.8 16.2L15.6 13.3Z" />
          </svg>
          <span class="ws-badge">多</span>
        </span>
        <span>Tadoku</span>
      </button>
    </SettingRow>

    <SettingRow label="Export Data" inputClass="gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-backdrop px-4 py-2 font-medium text-text border border-dim shadow-sm transition-all hover:bg-hover hover:text-white cursor-pointer"
        onclick={exportStats}
      >
        <span class="material-icons text-base">download</span>
        <span>Export Stats</span>
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-backdrop px-4 py-2 font-medium text-text border border-dim shadow-sm transition-all hover:bg-hover hover:text-white cursor-pointer"
        onclick={requestExportLines}
      >
        <span class="material-icons text-base">download</span>
        <span>Export Lines</span>
      </button>
    </SettingRow>

    <SettingRow label="Import Data" inputClass="gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-backdrop px-4 py-2 font-medium text-text border border-dim shadow-sm transition-all hover:bg-hover hover:text-white cursor-pointer"
        onclick={() => statsFileInput?.click()}
      >
        <span class="material-icons text-base">upload</span>
        <span>Import Stats</span>
      </button>
      <input
        bind:this={statsFileInput}
        class="hidden"
        type="file"
        accept=".csv"
        onchange={requestImportStats}
      />

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-backdrop px-4 py-2 font-medium text-text border border-dim shadow-sm transition-all hover:bg-hover hover:text-white cursor-pointer"
        onclick={() => linesFileInput?.click()}
      >
        <span class="material-icons text-base">upload</span>
        <span>Import Lines</span>
      </button>
      <input
        bind:this={linesFileInput}
        class="hidden"
        type="file"
        accept=".csv"
        onchange={requestImportLines}
      />
    </SettingRow>
  {/if}
</div>

<style global lang="postcss">
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  html,
  body {
    background: var(--exs-backdrop, #1e293b);
    color: var(--exs-text, #94a3b8);
    color-scheme: dark;
  }

  #top_bar {
    background: color-mix(in srgb, var(--exs-backdrop) 85%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--exs-border, transparent);
  }

  .border-dim {
    border-color: var(--exs-border-dim, #1e293b);
  }

  .menu-input {
    @apply col-start-2 grow bg-menu p-1 text-menu-text;
    border: 1px solid var(--exs-border, transparent);
  }

  .menu-label {
    @apply bg-block p-4 text-icon;
    border: 1px solid var(--exs-border, transparent);
  }

  .header-text {
    @apply inline-flex items-center text-4xl;
    color: var(--exs-title, #818cf8);
  }

  .header-icon {
    @apply h-full cursor-pointer hover:bg-hover hover:text-icon;
    color: var(--exs-title, #818cf8);
  }

  .ws-badge {
    position: absolute;
    bottom: -2px;
    right: -4px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    background: var(--exs-block, #0f172a);
    border-radius: 2px;
    padding: 0 1px;
    color: var(--exs-accent, #818cf8);
  }
</style>

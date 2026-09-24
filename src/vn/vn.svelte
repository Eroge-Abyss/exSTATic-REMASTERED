<script lang="ts">
  import { onMount } from "svelte";
  import * as browser from "webextension-polyfill";
  import { timeNowSeconds, timeToDateString } from "../calculations";
  import type { VNStorage } from "./vn_storage";
  import { InstanceStorage } from "../storage/instance_storage";
  import StatBar from "../components/interface/stat_bar.svelte";
  import MenuBar from "../components/interface/menu_bar.svelte";
  import MenuOption from "../components/interface/menu_option.svelte";
  import LineHolder from "../components/interface/line_holder.svelte";
  import ContextMenu from "../components/interface/context_menu.svelte";
  import { applyTheme } from "../themes/apply_theme";

  applyTheme();

  interface Props {
    vn_storage: VNStorage;
  }

  let { vn_storage }: Props = $props();
  let title = $state("Game");
  let lines: string[][] = $state([]);
  let menu = $state(false);
  let lunaConnected = $state(false);
  let tadokuConnected = $state(false);
  let showTexthookerWs = $state(true);
  let showTadokuWs = $state(true);
  let barHidden = $state(false);
  let restoreClickTimeout: any = null;
  let restoreClickCount = 0;

  onMount(async () => {
    const raw = await browser.storage.local.get([
      "show_texthooker_ws",
      "show_tadoku_ws",
      "show_websocket_icons",
    ]);
    showTexthookerWs =
      raw.show_texthooker_ws !== undefined
        ? !!raw.show_texthooker_ws
        : (raw.show_websocket_icons !== undefined ? !!raw.show_websocket_icons : true);
    showTadokuWs =
      raw.show_tadoku_ws !== undefined
        ? !!raw.show_tadoku_ws
        : (raw.show_websocket_icons !== undefined ? !!raw.show_websocket_icons : true);

    const storageListener = (
      changes: Record<string, browser.Storage.StorageChange>,
    ) => {
      if (changes.show_texthooker_ws !== undefined) {
        showTexthookerWs = !!changes.show_texthooker_ws.newValue;
      }
      if (changes.show_tadoku_ws !== undefined) {
        showTadokuWs = !!changes.show_tadoku_ws.newValue;
      }
      if (changes.show_websocket_icons !== undefined) {
        if (changes.show_texthooker_ws === undefined) {
          showTexthookerWs = !!changes.show_websocket_icons.newValue;
        }
        if (changes.show_tadoku_ws === undefined) {
          showTadokuWs = !!changes.show_websocket_icons.newValue;
        }
      }
    };
    browser.storage.onChanged.addListener(storageListener);
    return () => {
      browser.storage.onChanged.removeListener(storageListener);
    };
  });

  document.addEventListener("ws_status", (event: CustomEvent) => {
    if (event.detail.luna !== undefined) lunaConnected = event.detail.luna;
    if (event.detail.tadoku !== undefined) tadokuConnected = event.detail.tadoku;
  });

  // Events for media being added/replaced
  document.addEventListener("media_changed", (event: CustomEvent) => {
    // Show name and title
    title = event.detail["name"];

    // getLines() returns undefined for a game with no captured lines yet
    // (last_line_added === 0). Guard with ?? [] so .sort() never throws.
    lines = (event.detail["lines"] ?? []).sort(
      (
        first: [string, number, string, number],
        second: [string, number, string, number],
      ) => first[1] - second[1],
    );
  });

  document.addEventListener("new_line", (event) =>
    lines.push([
      vn_storage.uuid,
      event["detail"]["line_id"],
      event["detail"]["line"],
      event["detail"]["time"],
    ]),
  );

  // UI events
  const setTitle = (title: string) => {
    if (vn_storage == undefined || vn_storage.instance_storage == undefined)
      return;
    document.title = title + " | exSTATic";
    vn_storage.instance_storage.updateDetails({ name: title });
  };
  $effect(() => {
    setTitle(title);
  });


  const openStats = () => {
    browser.runtime.sendMessage({
      action: "open_tab",
      url: "https://kamwithk.github.io/exSTATic/stats.html",
    });
  };

  const handleHideBar = () => {
    menu = false;
    barHidden = true;
  };

  const handleDotsClick = () => {
    if (barHidden) {
      restoreClickCount++;
      if (restoreClickCount === 1) {
        clearTimeout(restoreClickTimeout);
        restoreClickTimeout = setTimeout(() => {
          restoreClickCount = 0;
        }, 2000);
      } else if (restoreClickCount >= 2) {
        clearTimeout(restoreClickTimeout);
        restoreClickCount = 0;
        barHidden = false;
      }
    } else {
      menu = !menu;
    }
  };

  const handleDotsDblClick = () => {
    if (barHidden) {
      clearTimeout(restoreClickTimeout);
      restoreClickCount = 0;
      barHidden = false;
    }
  };

  document.addEventListener("status_active", () => {
    document.documentElement.style.setProperty(
      "--default-inactivity-blur",
      "0",
    );
  });

  document.addEventListener("status_inactive", () => {
    document.documentElement.style.setProperty(
      "--default-inactivity-blur",
      vn_storage.properties["inactivity_blur"] + "px",
    );
  });

  const deleteLines = async () => {
    if (vn_storage.instance_storage === undefined) return;

    const checked_boxes = Array.from(
      document.querySelectorAll(".line-select:checked"),
    );

    if (checked_boxes.length === 0) return;

    const plural = checked_boxes.length > 1 ? "lines" : "line";

    const confirmed = confirm(
      `Are you sure you'd like to delete ${checked_boxes.length} ${plural}?\nChar and line statistics will be modified accordingly however time read won't change...`,
    );

    if (!confirmed) return;

    const parents = checked_boxes.map((checkbox) => checkbox.parentElement);
    const details = parents.map((element_div) => [
      Number.parseInt(element_div?.dataset.lineId!),
      element_div?.querySelector("p")?.textContent || element_div?.textContent || "",
      timeToDateString(Number.parseInt(element_div?.dataset.time!)),
      Number.parseInt(element_div?.dataset.time!) || timeNowSeconds(),
    ]);

    await vn_storage.deleteLines(details as any);
    parents.forEach((element_div) => element_div?.remove());
  };

  let showDeleteContextMenu = $state(false);
  let deleteContextMenuX = $state(0);
  let deleteContextMenuY = $state(0);
  let hasLastDeletion = $state(false);
  let lastDeletionCount = $state(0);
  let lastDeletionGame = $state("");

  const handleDeleteContextMenu = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const data = await browser.storage.local.get("last_deletion_backup");
    const backup = data.last_deletion_backup;
    hasLastDeletion = !!(backup && Array.isArray(backup.lines) && backup.lines.length > 0);
    lastDeletionCount = backup?.lines?.length ?? 0;
    lastDeletionGame = backup?.game_name ?? "Game";
    deleteContextMenuX = e.clientX;
    deleteContextMenuY = e.clientY;
    showDeleteContextMenu = true;
  };

  const restoreLastDeletion = async () => {
    showDeleteContextMenu = false;
    const data = await browser.storage.local.get("last_deletion_backup");
    const backup = data.last_deletion_backup;

    if (!backup || !Array.isArray(backup.lines) || backup.lines.length === 0) {
      alert("No deleted lines found to restore.");
      return;
    }

    const confirmed = confirm(
      `Restore ${backup.lines.length} deleted ${backup.lines.length === 1 ? 'line' : 'lines'} for "${backup.game_name || 'Game'}"?`,
    );
    if (!confirmed) return;

    // 1. Put line records back into storage:
    const lineEntries: Record<string, [string, number]> = {};
    for (const item of backup.lines) {
      lineEntries[JSON.stringify([backup.uuid, item.id])] = [item.line, item.time];
    }
    await browser.storage.local.set(lineEntries);

    // 2. Restore stats to instance storage:
    if (vn_storage && vn_storage.uuid === backup.uuid && vn_storage.instance_storage) {
      await vn_storage.instance_storage.addStats(backup.date_stats);

      const maxRestoredId = Math.max(...backup.lines.map((l: any) => l.id));
      if (maxRestoredId > (vn_storage.instance_storage.details.last_line_added ?? -1)) {
        await vn_storage.instance_storage.updateDetails({
          last_line_added: maxRestoredId,
        });
      }

      const updatedLines = await vn_storage.instance_storage.getLines();
      if (updatedLines) {
        lines = (updatedLines as [string, number, string, number][]).sort(
          (a, b) => a[1] - b[1],
        );
      }
    } else {
      const targetInstance = await InstanceStorage.buildInstance(backup.uuid);
      await targetInstance.addStats(backup.date_stats);
      const maxRestoredId = Math.max(...backup.lines.map((l: any) => l.id));
      if (maxRestoredId > (targetInstance.details.last_line_added ?? -1)) {
        await targetInstance.updateDetails({
          last_line_added: maxRestoredId,
        });
      }
    }

    // 3. Clear the backup
    await browser.storage.local.remove("last_deletion_backup");
    hasLastDeletion = false;
    lastDeletionCount = 0;

    alert(`Successfully restored ${backup.lines.length} ${backup.lines.length === 1 ? 'line' : 'lines'}!`);
  };
</script>

<div
  id="top_bar"
  class="sticky top-0 z-50 flex h-20 items-center justify-between px-12"
>
  <input
    id="game_name"
    class="jp-text h-full w-20 shrink grow justify-self-start"
    type="text"
    bind:value={title}
  />
  <div class="flex items-center gap-3">
    <div class="relative">
      <StatBar media_storage={vn_storage} collapsed={barHidden}>
        {#if showTexthookerWs || showTadokuWs}
          <div
            class="ws-icons-wrap flex items-center gap-3 whitespace-nowrap {barHidden ? 'collapsed' : ''}"
          >
            {#if showTexthookerWs}
              <span
                class="ws-plug-wrap"
                class:connected={lunaConnected}
                title={lunaConnected ? "Texthooker: connected" : "Texthooker: disconnected"}
              >
                <svg class="ws-plug" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.4 7.5C22.2 8.3 22.2 9.6 21.4 10.3L18.6 13.1L10.8 5.3L13.6 2.5C14.4 1.7 15.7 1.7 16.4 2.5L18.2 4.3L21.2 1.3L22.6 2.7L19.6 5.7L21.4 7.5M15.6 13.3L14.2 11.9L11.4 14.7L9.3 12.6L12.1 9.8L10.7 8.4L7.9 11.2L6.4 9.8L3.6 12.6C2.8 13.4 2.8 14.7 3.6 15.4L5.4 17.2L1.4 21.2L2.8 22.6L6.8 18.6L8.6 20.4C9.4 21.2 10.7 21.2 11.4 20.4L14.2 17.6L12.8 16.2L15.6 13.3Z" />
                </svg>
              </span>
            {/if}
            {#if showTadokuWs}
              <span
                class="ws-plug-wrap"
                class:connected={tadokuConnected}
                title={tadokuConnected ? "Tadoku: connected" : "Tadoku: disconnected"}
              >
                <svg class="ws-plug" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.4 7.5C22.2 8.3 22.2 9.6 21.4 10.3L18.6 13.1L10.8 5.3L13.6 2.5C14.4 1.7 15.7 1.7 16.4 2.5L18.2 4.3L21.2 1.3L22.6 2.7L19.6 5.7L21.4 7.5M15.6 13.3L14.2 11.9L11.4 14.7L9.3 12.6L12.1 9.8L10.7 8.4L7.9 11.2L6.4 9.8L3.6 12.6C2.8 13.4 2.8 14.7 3.6 15.4L5.4 17.2L1.4 21.2L2.8 22.6L6.8 18.6L8.6 20.4C9.4 21.2 10.7 21.2 11.4 20.4L14.2 17.6L12.8 16.2L15.6 13.3Z" />
                </svg>
                <span class="ws-badge">多</span>
              </span>
            {/if}
          </div>
        {/if}
        <button
          class="material-icons rounded-full hover:bg-hover cursor-pointer"
          onclick={handleDotsClick}
          ondblclick={handleDotsDblClick}
          title={barHidden ? "Click twice to show bar" : "Settings"}
        >more_vert</button>
      </StatBar>
      <MenuBar show={menu} media_storage={vn_storage}>
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

      <button
        id="settings_page"
        class="menu-button"
        onclick={() =>
          window.open("https://kamwithk.github.io/exSTATic/settings.html")}
      >
        Settings
      </button>
      <button id="view_stats" class="menu-button" onclick={openStats}
        >View Stats</button
      >
      <button id="hide_bar" class="menu-button" onclick={handleHideBar}
        >Hide Bar</button
      >
    </MenuBar>
    </div>
  </div>
  <button
    id="delete-selection"
    class="material-icons delete-button"
    onclick={deleteLines}
    oncontextmenu={handleDeleteContextMenu}
    title="Click to delete selected lines. Right-click to restore last deletion."
  >delete</button>
</div>

<ContextMenu
  bind:show={showDeleteContextMenu}
  x={deleteContextMenuX}
  y={deleteContextMenuY}
  title="Line Recovery"
>
  {#if hasLastDeletion}
    <button
      type="button"
      class="ctx-item"
      onclick={restoreLastDeletion}
    >
      <span class="material-icons text-sm text-accent">history</span>
      <span>Restore last deletion ({lastDeletionCount} {lastDeletionCount === 1 ? 'line' : 'lines'})</span>
    </button>
    <div class="px-3 py-1 text-[10px] text-muted">
      From: {lastDeletionGame}
    </div>
  {:else}
    <div class="px-3 py-2 text-xs text-muted">
      No recent deletion to restore
    </div>
  {/if}
</ContextMenu>

<div
  class="px-12"
  role="feed"
  ondblclick={vn_storage.toggleActive.bind(vn_storage)}
>
  <LineHolder
    bind:lines
    onclick={() => (menu = false)}
    on:dblclick
    {ondblclick}
  />
</div>

<style global lang="postcss">
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  input {
    border-style: none;
  }

  html,
  body {
    background-color: var(--exs-backdrop, #1e293b);
    color-scheme: dark;
  }

  .jp-text {
    font-family: var(--default-font);
    font-size: var(--default-font-size);
  }

  #top_bar {
    @apply bg-backdrop py-3;
  }

  #game_name {
    @apply bg-transparent text-4xl text-title;
  }

  .entry_holder {
    @apply bg-backdrop;
  }

  .sentence-entry {
    @apply jp-text flex items-center gap-4 bg-block p-4;
    filter: blur(var(--default-inactivity-blur));
  }

  .sentence {
    @apply jp-text inline-block grow text-left text-text;
  }

  .delete-button {
    @apply inline-flex self-center rounded-full p-2 text-button-text hover:bg-hover hover:text-icon;
  }

  .line-select {
    @apply h-4 w-4 shrink-0 rounded-full bg-button text-button-text;
  }

  .stat-numbers {
    @apply whitespace-nowrap font-mono text-base;
  }

  .stat-annotation {
    @apply whitespace-nowrap text-xs tracking-tighter;
  }

  .menu-bar {
    @apply flex h-full items-center gap-3 p-3 text-black hover:filter-none;
    color: #000000;
    background: color-mix(in srgb, var(--exs-accent) 70%, transparent);
    filter: blur(var(--default-menu-blur));
  }
  .menu-bar.collapsed {
    gap: 0 !important;
    padding: 2px !important;
    filter: none !important;
    border-radius: 9999px;
  }

  .ws-icons-wrap {
    max-width: 200px;
    opacity: 1;
    min-width: 0;
    transition: max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin 0.35s ease;
  }
  .ws-icons-wrap.collapsed {
    overflow: hidden !important;
    max-width: 0 !important;
    width: 0 !important;
    min-width: 0 !important;
    opacity: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    pointer-events: none !important;
  }

  .menu-button {
    @apply col-span-2 bg-block p-4 text-left text-icon hover:bg-hover;
  }

  .menu-input {
    @apply col-start-2 grow bg-menu p-1 text-menu-text;
  }

  .menu-label {
    @apply bg-block p-4 text-icon;
  }

  .ws-plug-wrap {
    position: relative;
    display: inline-flex;
    opacity: 0.3;
    transition: opacity 0.5s;
  }

  .ws-plug-wrap.connected {
    opacity: 1;
  }

  .ws-plug {
    @apply cursor-default;
    width: 1.5rem;
    height: 1.5rem;
    display: block;
  }

  .ws-badge {
    position: absolute;
    bottom: -2px;
    right: -4px;
    font-size: 0.7rem;
    font-weight: 700;
    font-family: system-ui, sans-serif;
    line-height: 1;
    opacity: 0.85;
    pointer-events: none;
    user-select: none;
  }
</style>

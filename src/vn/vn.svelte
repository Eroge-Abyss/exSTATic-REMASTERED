<script lang="ts">
  import { onMount } from "svelte";
  import * as browser from "webextension-polyfill";
  import { timeToDateString } from "../calculations";
  import type { VNStorage } from "./vn_storage";
  import StatBar from "../components/interface/stat_bar.svelte";
  import MenuBar from "../components/interface/menu_bar.svelte";
  import MenuOption from "../components/interface/menu_option.svelte";
  import LineHolder from "../components/interface/line_holder.svelte";
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
      element_div?.textContent,
      timeToDateString(Number.parseInt(element_div?.dataset.time!)),
    ]);

    await vn_storage.deleteLines(details as [[number, string, string]]);
    parents.forEach((element_div) => element_div?.remove());
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
                  <path d="M5,4C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H9V18H5V8H19V18H15V20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4H5M12,11A3,3 0 0,0 9,14A3,3 0 0,0 12,17A3,3 0 0,0 15,14A3,3 0 0,0 12,11Z" />
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
                  <path d="M5,4C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H9V18H5V8H19V18H15V20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4H5M12,11A3,3 0 0,0 9,14A3,3 0 0,0 12,17A3,3 0 0,0 15,14A3,3 0 0,0 12,11Z" />
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
    onclick={deleteLines}>delete</button
  >
</div>

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
    top: -2px;
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

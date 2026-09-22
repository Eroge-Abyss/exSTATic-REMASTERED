<script lang="ts">
  import MenuOption from "../components/interface/menu_option.svelte";
  import type { MokuroStorage } from "../mokuro/mokuro_storage";
  import type { TTUStorage } from "../ttu/ttu_storage";
  import { VNStorage } from "../vn/vn_storage";
  import * as browser from "webextension-polyfill";
  import { onMount } from "svelte";
  import { applyTheme, setTheme } from "../themes/apply_theme";
  import { themeList, type ThemeId } from "../themes/themes";

  let type = $state("vn");
  let disableAnimations = $state(false);
  let currentTheme = $state<ThemeId>("dark");

  onMount(async () => {
    currentTheme = await applyTheme();
    const data = await browser.storage.local.get("disable_animations");
    disableAnimations = !!data.disable_animations;
  });

  const toggleAnimations = async () => {
    disableAnimations = !disableAnimations;
    await browser.storage.local.set({ disable_animations: disableAnimations });
  };

  const handleThemeChange = async (newTheme: ThemeId) => {
    currentTheme = newTheme;
    await setTheme(newTheme);
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
    class="sticky top-0 z-50 flex h-20 justify-center"
  >
    <div class="flex flex-row place-items-center gap-3">
      <p class="header-text">Settings</p>
      <select class="bg-button text-white rounded px-2 py-1 font-medium outline-none" bind:value={type}>
        <option value="vn">VN</option>
        <option value="mokuro">Mokuro</option>
        <option value="ttu">TTU</option>
        <option value="global">Global Dash</option>
      </select>
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
    <div class="menu-label text-xl">Theme</div>
    <div class="menu-input flex flex-wrap items-center justify-end gap-2.5 p-4">
      {#each themeList as theme}
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all {currentTheme === theme.id
            ? 'bg-button ring-2 ring-white/40'
            : 'bg-backdrop text-text hover:text-white'}"
          style={currentTheme === theme.id ? 'color: var(--exs-accent-text, #ffffff);' : ''}
          onclick={() => handleThemeChange(theme.id)}
        >
          <span
            class="inline-block h-3.5 w-3.5 rounded-full border shadow-sm"
            style="background: linear-gradient(135deg, {theme.background} 50%, {theme.primary} 50%); border-color: {theme.accent};"
          ></span>
          {theme.name}
        </button>
      {/each}
    </div>

    <div class="menu-label text-xl">Disable Dashboard Animations</div>
    <div class="menu-input flex items-center justify-end p-4">
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
    </div>
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
</style>

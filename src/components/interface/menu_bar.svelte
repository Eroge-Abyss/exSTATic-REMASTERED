<script lang="ts">
  import type { MediaStorage } from "../../storage/media_storage";
  import MenuOption from "./menu_option.svelte";

  interface Props {
    show?: boolean;
    media_storage: MediaStorage;
    children?: import("svelte").Snippet;
  }

  let { show = false, media_storage, children }: Props = $props();
</script>

<div
  class="{show ? 'grid' : 'hidden'} absolute right-0 top-full z-50 mt-1 w-full rounded-lg shadow-xl grid-cols-1"
  style="background: rgba(15,23,42,0.97); backdrop-filter: blur(8px); border: 1px solid rgba(129,140,248,0.15);"
>
  {#if children}{@render children()}{:else}
    <MenuOption
      {media_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="60"
    />
    <MenuOption
      {media_storage}
      id="inactivity_blur"
      description="Inactivity Blur"
      units="px"
      value="2"
    />
    <MenuOption
      {media_storage}
      id="menu_blur"
      description="Menu Blur"
      units="px"
      value="8"
      root_css="--default-menu-blur"
    />
  {/if}
</div>

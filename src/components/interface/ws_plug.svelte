<script lang="ts">
  interface Props {
    type?: "texthooker" | "tadoku";
    connected?: boolean;
    title?: string;
    class?: string;
    size?: string;
  }

  let {
    type = "texthooker",
    connected = true,
    title,
    class: className = "",
    size = "1.5rem",
  }: Props = $props();
</script>

<span
  class="ws-plug-wrap {className}"
  class:connected
  {title}
  style="font-size: {size};"
>
  <span class="material-icons ws-plug">electrical_services</span>
  {#if type === "tadoku"}
    <span class="ws-badge">多</span>
  {/if}
</span>

<style>
  .ws-plug-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.3;
    transition: opacity 0.5s;
    line-height: 1;
    vertical-align: middle;
  }

  .ws-plug-wrap.connected {
    opacity: 1;
  }

  .ws-plug {
    cursor: default;
    font-size: 1em;
    line-height: 1;
    display: inline-block;
  }

  .ws-badge {
    position: absolute;
    top: -0.083em;
    right: -0.167em;
    font-size: 0.467em;
    font-weight: 700;
    font-family: system-ui, -apple-system, sans-serif;
    line-height: 1;
    opacity: 0.85;
    pointer-events: none;
    user-select: none;
  }
</style>

<script lang="ts">
  interface Props {
    groups: string[];
    hues: string[];
    selectedGroup?: string | null;
    hoveredGroup?: string | null;
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
    onselect?: (group: string | null) => void;
  }

  let {
    groups,
    hues,
    selectedGroup = null,
    hoveredGroup = null,
    color_overrides = {},
    oncolorchange,
    onselect,
  }: Props = $props();

  function getColor(group: string, index: number): string {
    return color_overrides[group] ?? hues[index];
  }

  function handleClick(group: string) {
    if (!onselect) return;
    onselect(selectedGroup === group ? null : group);
  }
</script>

<div class="lg-row">
  {#each groups as grp, i}
    {@const color = getColor(grp, i)}
    {@const isSelected = selectedGroup === grp}
    {@const isHovered = hoveredGroup === grp}
    {@const dimmed = selectedGroup !== null && !isSelected}
    <button
      class="lg-pill"
      class:lg-pill-active={isSelected}
      class:lg-pill-hovered={isHovered && !isSelected}
      class:lg-pill-dimmed={dimmed && !isHovered}
      style="--pill-color: {color};"
      onclick={() => handleClick(grp)}
    >
      <div class="lg-dot-wrapper" title="Change color">
        <input
          type="color"
          class="lg-color-picker"
          value={color}
          oninput={(e) => oncolorchange?.(grp, e.currentTarget.value)}
          onclick={(e) => e.stopPropagation()}
        />
        <span class="lg-dot" style="background: {color};"></span>
      </div>
      <span class="lg-label">{grp}</span>
    </button>
  {/each}
</div>

<style>
  .lg-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    padding: 6px 0;
  }
  .lg-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid #1e1b4b;
    border-radius: 16px;
    background: transparent;
    color: #64748b;
    font-size: 0.75rem;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .lg-pill:hover {
    color: #e2e8f0;
    border-color: var(--pill-color);
  }
  :global(.lg-pill-active) {
    background: color-mix(
      in srgb,
      var(--pill-color) 20%,
      transparent
    ) !important;
    border-color: var(--pill-color) !important;
    color: #e2e8f0 !important;
  }
  :global(.lg-pill-hovered) {
    border-color: var(--pill-color) !important;
    color: #cbd5e1 !important;
    background: rgba(255, 255, 255, 0.03) !important;
  }
  :global(.lg-pill-dimmed) {
    opacity: 0.4 !important;
  }
  .lg-dot-wrapper {
    position: relative;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .lg-color-picker {
    position: absolute;
    inset: -2px;
    width: 18px;
    height: 18px;
    opacity: 0;
    cursor: pointer;
    z-index: 10;
  }
  .lg-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
  }
  .lg-pill:hover .lg-dot {
    width: 10px;
    height: 10px;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
  }
  .lg-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
</style>

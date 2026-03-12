<script lang="ts">
  import * as browser from "webextension-polyfill";

  interface Props {
    groups: string[];
    hues: string[];
    color_overrides?: Record<string, string>;
    oncolorchange?: (group: string, color: string) => void;
  }

  let { groups, hues, color_overrides = {}, oncolorchange }: Props = $props();

  function getColor(group: string, index: number): string {
    return color_overrides[group] ?? hues[index];
  }

  function handleColorChange(group: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const color = input.value;
    if (oncolorchange) {
      oncolorchange(group, color);
    }
  }
</script>

<div class="flex flex-col gap-0.5">
  {#each groups as group, index}
    <div class="flex flex-row items-center gap-1">
      <label class="relative z-50 h-4 w-4 shrink-0 grow-0 cursor-pointer rounded-full"
        style="background-color: {getColor(group, index)};"
      >
        <input
          type="color"
          value={getColor(group, index)}
          onchange={(e) => handleColorChange(group, e)}
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <p class="text-[#808080] text-xs">{group}</p>
    </div>
  {/each}
</div>

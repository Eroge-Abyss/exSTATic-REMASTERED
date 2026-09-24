<script lang="ts">
  import type { MediaStorage } from "../../storage/media_storage";
  import { onMount } from "svelte";
  import type { HTMLInputTypeAttribute } from "svelte/elements";
  import type { TypeProperties } from "../../storage/type_storage";

  interface Props {
    media_storage: MediaStorage;
    id: keyof TypeProperties;
    label: string;
    description?: string;
    units?: string;
    type?: HTMLInputTypeAttribute;
    defaultValue?: string | number;
    root_css?: string;
    min?: number;
    max?: number;
    step?: number;
  }

  let {
    media_storage,
    id,
    label,
    description = "",
    units = "",
    type = "number",
    defaultValue = "",
    root_css = undefined,
    min = undefined,
    max = undefined,
    step = undefined,
  }: Props = $props();

  let value = $state<string | number>(defaultValue);
  let input_element: HTMLInputElement | undefined = $state();

  const update = async (event: Event) => {
    value = (event.target as HTMLInputElement).value;

    if (root_css !== undefined) {
      document.documentElement.style.setProperty(root_css, `${value}${units}`);
    }

    if (media_storage && media_storage.type_storage) {
      await media_storage.type_storage.updateProperties({ [id]: value });
    }
  };

  onMount(async () => {
    if (media_storage && media_storage.properties && media_storage.properties.hasOwnProperty(id) && input_element) {
      value = media_storage.properties[id];
      input_element.value = (value ?? "").toString();

      if (root_css !== undefined) {
        document.documentElement.style.setProperty(
          root_css,
          `${value}${units}`,
        );
      }
    } else if (media_storage && media_storage.type_storage) {
      await media_storage.type_storage.updateProperties({
        [id]: defaultValue,
      });
      value = defaultValue;
    }

    if (input_element?.value !== undefined) {
      input_element.dispatchEvent(new Event("change"));
    }
  });
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 border-b border-dim/40 last:border-b-0">
  <div class="flex flex-col pr-4">
    <span class="text-sm font-medium text-strong">{label}</span>
    {#if description}
      <span class="text-xs text-muted mt-0.5 leading-relaxed">{description}</span>
    {/if}
  </div>
  <div class="flex items-center gap-2 sm:justify-end shrink-0">
    <div class="relative flex items-center">
      <input
        bind:this={input_element}
        {type}
        {value}
        {min}
        {max}
        {step}
        onchange={update}
        class="h-9 {type === 'number' ? 'w-24 text-right' : 'w-44 text-left'} {units ? 'pr-9' : 'pr-3'} pl-3 text-sm bg-surface border border-dim rounded-lg text-strong focus:border-accent focus:outline-none transition-colors"
      />
      {#if units}
        <span class="absolute right-2.5 text-xs font-semibold text-muted uppercase pointer-events-none select-none">
          {units}
        </span>
      {/if}
    </div>
  </div>
</div>

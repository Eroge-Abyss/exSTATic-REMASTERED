<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    description?: string;
    inputClass?: string;
    children?: Snippet;
  }

  let { label, description = "", inputClass = "", children }: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 border-b border-white/[0.05] last:border-b-0">
  <div class="flex flex-col pr-4">
    <span class="text-sm font-medium text-strong">{label}</span>
    {#if description}
      <span class="text-xs text-muted mt-0.5 leading-relaxed">{description}</span>
    {/if}
  </div>
  <div class="flex items-center gap-2 sm:justify-end shrink-0 {inputClass}">
    {@render children?.()}
  </div>
</div>

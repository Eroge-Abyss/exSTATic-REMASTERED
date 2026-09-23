<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    inputClass?: string;
    children?: Snippet;
  }

  let { label, inputClass = "", children }: Props = $props();
</script>

<div class="menu-label text-xl">{label}</div>
<div class="menu-input flex items-center justify-end p-4 {inputClass}">
  {@render children?.()}
</div>

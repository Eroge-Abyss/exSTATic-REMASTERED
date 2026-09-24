<script lang="ts">
  interface Props {
    checked: boolean;
    onToggle: () => void | Promise<void>;
    label?: string;
    disabled?: boolean;
  }

  let { checked, onToggle, label = "Toggle setting", disabled = false }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={onToggle}
  class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {checked
    ? 'bg-button'
    : 'bg-surface border-dim'} {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
>
  <span
    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out {checked
      ? 'translate-x-5'
      : 'translate-x-0'}"
  ></span>
</button>

<template>
  <div
    ref="rootEl"
    class="customDropdown"
    :class="{ 'is-open': isOpen, 'is-disabled': disabled, 'is-focused': isFocused }"
  >
    <button
      ref="buttonEl"
      :id="buttonId"
      class="customDropdown__button"
      type="button"
      :disabled="disabled"
      :aria-expanded="isOpen ? 'true' : 'false'"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-label="ariaLabel"
      @click="toggle"
      @keydown="onButtonKeydown"
      @focus="isFocused = true"
      @blur="onButtonBlur"
    >
      <span
        class="customDropdown__value"
        :class="{ 'is-placeholder': !selectedOptionLabel }"
      >
        {{ selectedOptionLabel || placeholder }}
      </span>

      <span class="customDropdown__arrow" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
          <path d="M5.5 7.5l4.5 5 4.5-5z" />
        </svg>
      </span>
    </button>

    <transition name="customDropdownFade">
      <ul
        v-show="isOpen"
        ref="listboxEl"
        class="customDropdown__list"
        role="listbox"
        :id="listboxId"
        tabindex="-1"
        :aria-labelledby="buttonId"
        :aria-activedescendant="activeDescendantId"
        @keydown="onListboxKeydown"
        @mousedown.prevent
      >
        <li
          v-for="(opt, idx) in normalizedOptions"
          :key="opt.key"
          :id="getOptionId(idx)"
          class="customDropdown__option"
          :class="{
            'is-active': idx === activeIndex,
            'is-selected': isSelected(opt),
            'is-disabled': !!opt.disabled,
          }"
          role="option"
          :aria-selected="isSelected(opt) ? 'true' : 'false'"
          :aria-disabled="opt.disabled ? 'true' : 'false'"
          @mouseenter="setActiveIndex(idx)"
          @click="onOptionClick(opt)"
        >
          {{ opt.label }}
        </li>
      </ul>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

type Primitive = string | number | boolean | null;

type OptionLike =
  | Primitive
  | {
      label: string;
      value: Primitive;
      disabled?: boolean;
    };

type NormalizedOption = {
  key: string;
  label: string;
  value: Primitive;
  disabled?: boolean;
};

const props = withDefaults(
  defineProps<{
    modelValue: Primitive;
    options: OptionLike[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: 'Select…',
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: Primitive): void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const buttonEl = ref<HTMLButtonElement | null>(null);
const listboxEl = ref<HTMLUListElement | null>(null);

const isOpen = ref(false);
const isFocused = ref(false);
const activeIndex = ref<number>(-1);

const uid = Math.random().toString(36).slice(2, 9);
const buttonId = `customDropdownBtn_${uid}`;
const listboxId = `customDropdownList_${uid}`;

const normalizedOptions = computed<NormalizedOption[]>(() => {
  return (props.options || []).map((opt, i) => {
    if (opt && typeof opt === 'object' && 'label' in opt) {
      const o = opt as any;
      return {
        key: `${String(o.value)}_${i}`,
        label: String(o.label ?? ''),
        value: (o.value ?? null) as Primitive,
        disabled: !!o.disabled,
      };
    }
    return {
      key: `${String(opt)}_${i}`,
      label: opt == null ? '' : String(opt),
      value: (opt ?? null) as Primitive,
      disabled: false,
    };
  });
});

const selectedOption = computed(() => {
  return normalizedOptions.value.find((o) => o.value === props.modelValue) || null;
});

const selectedOptionLabel = computed(() => selectedOption.value?.label || '');

const ariaLabel = computed(() => {
  // Prefer a stable label for screen readers.
  if (selectedOptionLabel.value) return selectedOptionLabel.value;
  return props.placeholder || 'Select option';
});

const getOptionId = (idx: number) => `customDropdownOpt_${uid}_${idx}`;

const activeDescendantId = computed(() => {
  if (!isOpen.value) return undefined;
  if (activeIndex.value < 0) return undefined;
  return getOptionId(activeIndex.value);
});

function isSelected(opt: NormalizedOption) {
  return opt.value === props.modelValue;
}

function setActiveIndex(idx: number) {
  if (idx < 0 || idx >= normalizedOptions.value.length) return;
  activeIndex.value = idx;
}

function findFirstEnabledIndex(from: number, direction: 1 | -1) {
  const opts = normalizedOptions.value;
  if (!opts.length) return -1;

  let idx = from;
  for (let steps = 0; steps < opts.length; steps++) {
    idx = (idx + direction + opts.length) % opts.length;
    if (!opts[idx].disabled) return idx;
  }
  return -1;
}

function syncActiveIndexToValue() {
  const idx = normalizedOptions.value.findIndex((o) => o.value === props.modelValue);
  if (idx >= 0 && !normalizedOptions.value[idx].disabled) {
    activeIndex.value = idx;
  } else {
    // default to first enabled
    const firstEnabled = normalizedOptions.value.findIndex((o) => !o.disabled);
    activeIndex.value = firstEnabled;
  }
}

function open() {
  if (props.disabled) return;
  if (isOpen.value) return;
  isOpen.value = true;
  syncActiveIndexToValue();

  nextTick(() => {
    listboxEl.value?.focus();
    scrollActiveIntoView();
  });
}

function close({ returnFocus } = { returnFocus: true }) {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (returnFocus) {
    nextTick(() => buttonEl.value?.focus());
  }
}

function toggle() {
  if (isOpen.value) close();
  else open();
}

function selectOption(opt: NormalizedOption) {
  if (opt.disabled) return;
  emit('update:modelValue', opt.value);
}

function onOptionClick(opt: NormalizedOption) {
  if (opt.disabled) return;
  selectOption(opt);
  close();
}

function scrollActiveIntoView() {
  if (!listboxEl.value) return;
  if (activeIndex.value < 0) return;
  const id = getOptionId(activeIndex.value);
  const el = listboxEl.value.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  el?.scrollIntoView({ block: 'nearest' });
}

function onButtonKeydown(e: KeyboardEvent) {
  if (props.disabled) return;

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      e.preventDefault();
      open();
      break;
    case 'Enter':
    case ' ': // Space
      e.preventDefault();
      toggle();
      break;
    case 'Escape':
      if (isOpen.value) {
        e.preventDefault();
        close();
      }
      break;
  }
}

function onListboxKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return;

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;
    case 'Tab':
      // let focus move naturally, but close the popover
      close({ returnFocus: false });
      break;
    case 'ArrowDown': {
      e.preventDefault();
      const next = findFirstEnabledIndex(activeIndex.value, 1);
      if (next !== -1) {
        activeIndex.value = next;
        scrollActiveIntoView();
      }
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = findFirstEnabledIndex(activeIndex.value, -1);
      if (prev !== -1) {
        activeIndex.value = prev;
        scrollActiveIntoView();
      }
      break;
    }
    case 'Home': {
      e.preventDefault();
      const first = normalizedOptions.value.findIndex((o) => !o.disabled);
      if (first !== -1) {
        activeIndex.value = first;
        scrollActiveIntoView();
      }
      break;
    }
    case 'End': {
      e.preventDefault();
      const opts = normalizedOptions.value;
      for (let i = opts.length - 1; i >= 0; i--) {
        if (!opts[i].disabled) {
          activeIndex.value = i;
          scrollActiveIntoView();
          break;
        }
      }
      break;
    }
    case 'Enter':
    case ' ': {
      e.preventDefault();
      const opt = normalizedOptions.value[activeIndex.value];
      if (opt) {
        selectOption(opt);
        close();
      }
      break;
    }
  }
}

function onButtonBlur() {
  // We manage focus styles ourselves; keep focus state if moving into the listbox.
  // Delay to allow focus transition.
  window.setTimeout(() => {
    const active = document.activeElement;
    const stillInside = !!(rootEl.value && active && rootEl.value.contains(active));
    isFocused.value = stillInside;
    if (!stillInside) close({ returnFocus: false });
  }, 0);
}

function onDocumentPointerDown(e: PointerEvent) {
  if (!isOpen.value) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (rootEl.value && rootEl.value.contains(target)) return;
  close({ returnFocus: false });
}

watch(
  () => props.modelValue,
  () => {
    if (!isOpen.value) return;
    syncActiveIndexToValue();
    nextTick(scrollActiveIntoView);
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});
</script>

<style>
.customDropdown {
  position: relative;
}

.customDropdown__button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;

  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.customDropdown.is-disabled .customDropdown__button {
  cursor: not-allowed;
  opacity: 0.7;
}

.customDropdown__value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.customDropdown__value.is-placeholder {
  color: color-mix(in srgb, var(--text-secondary) 80%, transparent);
}

.customDropdown__arrow {
  width: 0.9rem;
  height: 0.9rem;
  color: color-mix(in srgb, var(--text-primary) 70%, transparent);
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.customDropdown__arrow svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.customDropdown__list {
  position: absolute;
  z-index: 50;
  left: 0;
  right: 0;
  margin-top: 0.4rem;

  max-height: 14rem;
  overflow: auto;

  list-style: none;
  padding: 0.35rem;
  margin-left: 0;
  margin-right: 0;
  margin-bottom: 0;

  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 0.9rem;
  box-shadow: var(--shadow-2);
  color: var(--text-primary);
}

.customDropdown__option {
  padding: 0.55rem 0.6rem;
  border-radius: 0.7rem;
  cursor: pointer;
  user-select: none;
}

.customDropdown__option.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.customDropdown__option.is-active:not(.is-disabled),
.customDropdown__option:hover:not(.is-disabled) {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.customDropdown__option.is-selected:not(.is-disabled) {
  background: color-mix(in srgb, var(--accent-color) 26%, transparent);
}

/* Focus/active states: match InputField styles */
.customDropdown.is-focused,
.customDropdown.is-open {
  border-color: color-mix(in srgb, var(--accent-color) 65%, var(--input-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 20%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.35) inset;
}

/* Privacy mask parity with select.password */
.customDropdown.password .customDropdown__value {
  color: transparent !important;
  background-image: radial-gradient(var(--text-primary) 60%, transparent 0%);
  background-size: 0.3rem 0.3rem;
  background-position: 0.5rem 0.65rem;
  background-clip: content-box;
  background-repeat: repeat-x;
}

.customDropdownFade-enter-active,
.customDropdownFade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.customDropdownFade-enter-from,
.customDropdownFade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

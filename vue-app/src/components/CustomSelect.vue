<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    id: string
    ariaLabel?: string
    hidden?: boolean
    disabled?: boolean
  }>(),
  { hidden: false, disabled: false },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const host = ref<HTMLDivElement | null>(null)
const menu = ref<HTMLDivElement | null>(null)
const open = ref(false)
const query = ref('')
const searchable = computed(() => /ProfileSelect|TemplateSelect/.test(props.id))
const groups = computed(() => {
  const result = new Map<string, SelectOption[]>()
  props.options
    .filter((option) =>
      option.label
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase()),
    )
    .forEach((option) => {
      const parts = option.label.split('/')
      const group =
        searchable.value && parts.length > 1
          ? parts.slice(0, -1).join(' / ')
          : ''
      if (!result.has(group)) result.set(group, [])
      result.get(group)!.push(option)
    })
  return [...result].map(([label, options]) => ({ label, options }))
})
const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)
let activeClose: (() => void) | null = null

function close(focus = false) {
  open.value = false
  host.value?.classList.remove('open-up')
  if (activeClose === close) activeClose = null
  if (focus) host.value?.querySelector('button')?.focus()
}

function positionMenu() {
  const element = host.value
  const popup = menu.value
  if (!element || !popup) return
  element.classList.remove('open-up')
  popup.style.maxHeight = 'none'
  popup.style.overflowY = 'hidden'

  const rect = element.getBoundingClientRect()
  let top = 8
  let bottom = window.innerHeight - 8
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))
      continue
    const parentRect = parent.getBoundingClientRect()
    top = Math.max(top, parentRect.top + 4)
    bottom = Math.min(bottom, parentRect.bottom - 4)
  }
  const contentHeight = popup.scrollHeight
  const desiredHeight = Math.min(contentHeight, window.innerHeight * 0.45, 280)
  const spaceBelow = Math.max(0, bottom - rect.bottom - 4)
  const spaceAbove = Math.max(0, rect.top - top - 4)
  const opensUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
  element.classList.toggle('open-up', opensUp)
  const availableHeight = Math.max(
    30,
    Math.min(window.innerHeight * 0.45, 280, opensUp ? spaceAbove : spaceBelow),
  )
  if (contentHeight > availableHeight + 1) {
    popup.style.maxHeight = `${Math.floor(availableHeight)}px`
    popup.style.overflowY = 'auto'
  }
}

async function showMenu() {
  if (props.disabled || open.value) return
  activeClose?.()
  query.value = ''
  open.value = true
  activeClose = close
  await nextTick()
  positionMenu()
  if (searchable.value) menu.value?.querySelector('input')?.focus()
  else
    menu.value
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus()
}

function toggleMenu() {
  if (open.value) close()
  else void showMenu()
}

function choose(value: string) {
  emit('update:modelValue', value)
  emit('change', value)
  close(true)
}

function handleOutside(event: PointerEvent) {
  if (!host.value?.contains(event.target as Node)) close()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) {
      void showMenu()
      return
    }
    const items = [
      ...(menu.value?.querySelectorAll<HTMLButtonElement>('button') || []),
    ]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[
      index < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (index + step + items.length) % items.length
    ]?.focus()
  } else if (
    (event.key === 'Home' || event.key === 'End') &&
    !(event.target instanceof HTMLInputElement)
  ) {
    event.preventDefault()
    const items = menu.value?.querySelectorAll<HTMLButtonElement>('button')
    items?.[event.key === 'Home' ? 0 : items.length - 1]?.focus()
  } else if (event.key === 'Tab') close()
}

onMounted(() => document.addEventListener('pointerdown', handleOutside))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutside)
  if (activeClose === close) activeClose = null
})
</script>

<template>
  <div
    ref="host"
    class="custom-select-host"
    :hidden="hidden"
    @keydown="handleKeydown"
  >
    <button
      :id="`${id}-custom-trigger`"
      type="button"
      class="custom-select-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="`${id}-custom-menu`"
      @click.stop="toggleMenu"
    >
      <span class="custom-select-value">{{
        selected?.label ?? modelValue
      }}</span>
    </button>
    <select
      :id="id"
      class="custom-select-native"
      :value="modelValue"
      :disabled="disabled"
      aria-hidden="true"
      tabindex="-1"
      @change="choose(($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>
    <div
      :id="`${id}-custom-menu`"
      ref="menu"
      class="custom-select-menu"
      role="listbox"
      :hidden="!open"
    >
      <input
        v-if="searchable"
        v-model="query"
        type="search"
        autocomplete="off"
        :name="`orbit-${id}-filter`"
        placeholder="输入筛选模板"
        aria-label="筛选模板"
        @input="nextTick(positionMenu)"
      />
      <template v-for="group in groups" :key="group.label">
        <div v-if="searchable && group.label" class="template-group-label">
          {{ group.label }}
        </div>
        <button
          v-for="option in group.options"
          :key="option.value"
          type="button"
          class="custom-select-option"
          role="option"
          :aria-selected="option.value === modelValue"
          :class="{ selected: option.value === modelValue }"
          @click="choose(option.value)"
        >
          {{
            searchable && group.label
              ? option.label.split('/').at(-1)
              : option.label
          }}
        </button>
      </template>
      <div v-if="!groups.length" class="template-group-label">无匹配模板</div>
    </div>
  </div>
</template>

<style scoped>
.template-group-label {
  padding: 7px 10px 3px;
  color: var(--muted);
  font-size: 11px;
}
.custom-select-menu > input[type='search'] {
  width: calc(100% - 12px);
  margin: 6px;
  min-height: 30px;
}
</style>

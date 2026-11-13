<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    models: string[]
    id: string
    label: string
    placeholder?: string
    refresh?: boolean
    refreshing?: boolean
    disabled?: boolean
  }>(),
  { placeholder: '', refresh: false, refreshing: false, disabled: false },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  refresh: []
}>()

const host = ref<HTMLDivElement | null>(null)
const menu = ref<HTMLDivElement | null>(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const options = computed(() => {
  const value = query.value.toLocaleLowerCase()
  return props.models
    .filter((model) => !value || model.toLocaleLowerCase().includes(value))
    .sort()
    .slice(0, 80)
})

function close() {
  open.value = false
  activeIndex.value = -1
}

function positionMenu() {
  const anchor =
    host.value?.closest<HTMLElement>('.quick-setting, .field-label') ||
    host.value
  const dropdown = menu.value
  if (!anchor || !dropdown) return

  const rect = anchor.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop || 0
  const viewportHeight = viewport?.height || window.innerHeight
  const spaceAbove = Math.max(0, rect.top - viewportTop - 8)
  const spaceBelow = Math.max(0, viewportTop + viewportHeight - rect.bottom - 8)
  const opensUp =
    spaceBelow < Math.min(dropdown.scrollHeight, 210) && spaceAbove > spaceBelow
  const available = opensUp ? spaceAbove : spaceBelow

  dropdown.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`
  dropdown.style.width = `${Math.max(1, Math.min(rect.width, window.innerWidth - 16))}px`
  dropdown.style.maxHeight = `${Math.max(1, Math.min(210, available))}px`
  dropdown.style.top = opensUp
    ? 'auto'
    : `${Math.max(viewportTop, rect.bottom - 2)}px`
  dropdown.style.bottom = opensUp
    ? `${Math.max(0, window.innerHeight - rect.top + 2)}px`
    : 'auto'
}

function showAll() {
  query.value = ''
  open.value = true
  activeIndex.value = -1
  void nextTick(positionMenu)
}

function filterOptions(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
  query.value = value.trim()
  open.value = true
  activeIndex.value = options.value.length ? 0 : -1
  void nextTick(positionMenu)
}

function choose(model: string) {
  emit('update:modelValue', model)
  close()
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!open.value) {
      event.preventDefault()
      showAll()
      activeIndex.value =
        event.key === 'ArrowDown' ? 0 : options.value.length - 1
      return
    }
    if (!options.value.length) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value =
      (activeIndex.value + step + options.value.length) % options.value.length
  } else if (event.key === 'Enter' && open.value && activeIndex.value >= 0) {
    event.preventDefault()
    choose(options.value[activeIndex.value])
  }
}

function outside(event: PointerEvent) {
  if (
    !host.value?.contains(event.target as Node) &&
    !menu.value?.contains(event.target as Node)
  )
    close()
}

function reposition() {
  if (open.value) positionMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  window.visualViewport?.addEventListener('resize', reposition)
  window.visualViewport?.addEventListener('scroll', reposition)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
  window.visualViewport?.removeEventListener('resize', reposition)
  window.visualViewport?.removeEventListener('scroll', reposition)
})
</script>

<template>
  <div ref="host" class="model-input-host">
    <input
      :id="id"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label"
      :aria-controls="`${id}-options`"
      :aria-expanded="open"
      aria-autocomplete="list"
      autocomplete="off"
      role="combobox"
      type="text"
      :disabled="disabled"
      @focus="showAll"
      @click="showAll"
      @input="filterOptions"
      @keydown="keydown"
    />
    <Teleport to="body">
      <div
        v-if="open"
        :id="`${id}-options`"
        ref="menu"
        class="model-dropdown"
        role="listbox"
      >
        <div class="model-options">
          <button
            v-for="(model, index) in options"
            :key="model"
            type="button"
            class="model-option"
            role="option"
            :aria-selected="index === activeIndex"
            :title="model"
            @mousedown.prevent
            @click="choose(model)"
          >
            {{ model }}
          </button>
          <div v-if="!options.length" class="model-option">
            暂无匹配模型，可直接输入模型名
          </div>
        </div>
        <button
          v-if="refresh"
          type="button"
          class="model-refresh"
          :disabled="refreshing"
          :aria-busy="refreshing"
          @mousedown.prevent
          @click="emit('refresh')"
        >
          {{ refreshing ? '获取中...' : '获取模型' }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, type CSSProperties } from 'vue'
import type { ReferenceImage } from '../types/models'
import { useImageMentions } from '../composables/useImageMentions'
import { useTextarea } from '../composables/useTextarea'

const model = defineModel<string>({ required: true })
const props = withDefaults(
  defineProps<{
    id: string
    images: ReferenceImage[]
    labels?: string[]
    placeholder?: string
    rows?: number
    strictMentions?: boolean
    mentionsEnabled?: boolean
    autoResize?: boolean
  }>(),
  { strictMentions: false, mentionsEnabled: true, autoResize: false },
)
const emit = defineEmits<{
  paste: [event: ClipboardEvent]
  drop: [files: File[]]
  focus: []
}>()
const labels = computed(
  () => props.labels || props.images.map((_, index) => `@图${index + 1}`),
)
const input = useTemplateRef<HTMLTextAreaElement>('input')
const mirror = useTemplateRef<HTMLDivElement>('mirror')
const menu = useTemplateRef<HTMLDivElement>('menu')
const wrap = useTemplateRef<HTMLDivElement>('wrap')
const tooltip = ref<{ src: string; style: CSSProperties } | null>(null)
const dropping = ref(false)
useTextarea(input, model, () => props.autoResize, 260)
function dragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dropping.value = true
}
function drop(event: DragEvent) {
  dropping.value = false
  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    file.type.startsWith('image/'),
  )
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  emit('drop', files)
}
const {
  focused,
  menuIndex,
  menuStyle,
  showMenu,
  suggestions,
  segments,
  updateCaret,
  syncScroll,
  insert,
  insertReference,
  keydown,
  compositionStart,
  compositionEnd,
  blur,
  placeCaret,
} = useImageMentions(model, () => labels.value, input, mirror, menu, wrap, {
  strictMentions: props.strictMentions,
  enabled: () => props.mentionsEnabled,
})

function showMentionPreview(index: number, event: MouseEvent) {
  const image = props.images[index]
  if (!image) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 148))
  const top =
    rect.bottom + 110 <= window.innerHeight ? rect.bottom + 6 : rect.top - 110
  tooltip.value = {
    src: image.data,
    style: { left: `${left}px`, top: `${top}px` },
  }
}

function focus() {
  focused.value = true
  updateCaret()
  emit('focus')
}

function scroll() {
  tooltip.value = null
  syncScroll()
}
defineExpose({ insertReference })
</script>

<template>
  <div ref="wrap" class="image-prompt-wrap">
    <textarea
      :id="id"
      ref="input"
      v-model="model"
      :rows="rows || 4"
      :placeholder="placeholder"
      :class="{ 'image-drop-active': dropping }"
      @dragover="dragOver"
      @dragleave="dropping = false"
      @drop="drop"
      @input="updateCaret"
      @click="updateCaret"
      @keyup="
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes($event.key) &&
        updateCaret()
      "
      @focus="focus"
      @blur="blur"
      @keydown="keydown"
      @compositionstart="compositionStart"
      @compositionend="compositionEnd"
      @scroll="scroll"
      @paste="emit('paste', $event)"
    />
    <div
      :id="`${id}Mirror`"
      ref="mirror"
      class="image-prompt-mirror"
      aria-hidden="true"
    >
      <template v-for="(segment, index) in segments" :key="index">
        <span
          v-if="segment.type === 'caret'"
          class="image-mention-caret"
        ></span>
        <span
          v-else-if="segment.type === 'mention'"
          class="image-mention-token"
          :class="{ invalid: segment.index < 0 }"
          @mousedown.stop.prevent="placeCaret(segment)"
          @mouseenter="showMentionPreview(segment.index, $event)"
          @mouseleave="tooltip = null"
          >{{ segment.text }}</span
        >
        <template v-else>{{ segment.text }}</template>
      </template>
    </div>
    <Teleport to="body">
      <div
        v-if="showMenu"
        ref="menu"
        class="image-mention-menu"
        :style="menuStyle"
        role="listbox"
      >
        <button
          v-for="(option, index) in suggestions"
          :key="option.label"
          class="image-mention-option"
          type="button"
          role="option"
          :aria-selected="menuIndex === index"
          :class="{ active: menuIndex === index }"
          @mousedown.prevent="insert(index)"
        >
          <img v-image-source="images[option.index]?.data" alt="" />{{
            option.label
          }}<span
            v-if="images[option.index]?.origin"
            class="image-mention-origin"
            :data-origin="
              images[option.index]?.origin === '输出' ? 'output' : 'input'
            "
            >{{ images[option.index]?.origin }}</span
          >
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="tooltip" class="image-mention-tooltip" :style="tooltip.style">
        <img v-image-source.full="tooltip.src" alt="参考图预览" />
      </div>
    </Teleport>
  </div>
</template>

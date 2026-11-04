<script setup lang="ts">
import type { ReferenceImage } from '../types/models'
import { useInterfaceStore } from '../stores/interface'
import { inputFiles } from '../utils/events'
import { ref } from 'vue'

const props = defineProps<{ images: ReferenceImage[]; label?: string }>()
const emit = defineEmits<{
  remove: [index: number]
  replace: [index: number, file: File]
  move: [from: number, to: number]
  mention: [index: number]
}>()
const ui = useInterfaceStore()
let dragIndex = -1
const dragging = ref(-1)
const dropIndex = ref(-1)
const fileInput = ref<HTMLInputElement | null>(null)
let replaceIndex = -1
function replace(event: Event) {
  const file = inputFiles(event)[0]
  if (file && replaceIndex >= 0) emit('replace', replaceIndex, file)
}
function chooseReplacement(index: number) {
  replaceIndex = index
  fileInput.value?.click()
}
function preview(index: number) {
  ui.openViewer(
    props.images.map((item) => item.data),
    index,
  )
}
function dragStart(event: DragEvent, index: number) {
  if (
    (event.target as Element).closest('button:not(.polish-reference-thumb)')
  ) {
    event.preventDefault()
    return
  }
  dragIndex = index
  dragging.value = index
  event.dataTransfer!.effectAllowed = 'move'
  event.dataTransfer!.setData('text/plain', String(index))
}
function drop(index: number) {
  if (dragIndex >= 0 && dragIndex !== index) emit('move', dragIndex, index)
  endDrag()
}
function endDrag() {
  dragIndex = -1
  dragging.value = -1
  dropIndex.value = -1
}
function mention(event: MouseEvent, index: number) {
  if (
    (event.target as Element).closest(
      '.replace-reference, .remove-reference, .replace-polish-reference, .remove-polish-reference',
    )
  )
    return
  event.preventDefault()
  emit('mention', index)
}
</script>
<template>
  <div
    :class="label ? 'polish-reference-preview' : 'image-reference-preview'"
    :hidden="!images.length"
  >
    <div
      v-for="(image, index) in images"
      :key="image.id"
      :class="[
        label ? 'polish-reference-item' : 'reference-preview-item',
        { 'is-dragging': dragging === index, 'drag-over': dropIndex === index },
      ]"
      :data-order-index="index"
      draggable="true"
      @dragstart="dragStart($event, index)"
      @dragover.prevent="dragIndex >= 0 && (dropIndex = index)"
      @dragleave="dropIndex = -1"
      @drop.stop.prevent="drop(index)"
      @dragend="endDrag"
      @contextmenu="mention($event, index)"
    >
      <button
        v-if="label"
        type="button"
        class="polish-reference-thumb"
        :aria-label="`预览${label} ${index + 1}`"
        :data-tooltip="`预览${label} ${index + 1}`"
        @click="preview(index)"
      >
        <img
          :src="image.data"
          :alt="`${label} ${index + 1}`"
          draggable="false"
          decoding="async"
        />
        <span class="polish-reference-badge"
          >{{ label.replace('参考图', '') }} {{ index + 1 }}</span
        >
      </button>
      <img
        v-else
        :src="image.data"
        :alt="`生图参考图 ${index + 1}`"
        draggable="false"
        decoding="async"
        @click="preview(index)"
      />
      <span v-if="!label" class="reference-preview-index">{{ index + 1 }}</span>
      <button
        type="button"
        :class="label ? 'replace-polish-reference' : 'replace-reference'"
        :aria-label="`更换${label || '参考图'} ${index + 1}`"
        :data-tooltip="`更换${label || '参考图'} ${index + 1}`"
        @click="chooseReplacement(index)"
      >
        ↻
      </button>
      <button
        type="button"
        :class="label ? 'remove-polish-reference' : 'remove-reference'"
        :aria-label="`移除${label || '参考图'} ${index + 1}`"
        :data-tooltip="`移除${label || '参考图'} ${index + 1}`"
        @click="emit('remove', index)"
      >
        ×
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="replace"
    />
  </div>
</template>

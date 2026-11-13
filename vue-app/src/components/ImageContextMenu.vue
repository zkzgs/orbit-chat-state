<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useViewerStore } from '../stores/viewer'
import { useInterfaceStore } from '../stores/interface'
import { useChatStore } from '../stores/chat'
import { copyImage, downloadImage } from '../utils/images'
import { errorMessage } from '../utils/format'
import type { StoredImage } from '../types/models'

type ContextTarget =
  | {
      kind: 'history'
      buttons: { label: string; element: HTMLButtonElement }[]
    }
  | { kind: 'chat'; image: StoredImage }

const chat = useChatStore()
const workspace = useWorkspaceStore()
const viewer = useViewerStore()
const ui = useInterfaceStore()
const menu = ref<HTMLElement | null>(null)
const target = ref<ContextTarget | null>(null)
const position = ref({ left: 0, top: 0 })

async function open(event: MouseEvent) {
  const element = event.target
  if (!(element instanceof Element)) return
  const card = element.closest<HTMLElement>(
    '.history-item, .generation-task-card',
  )
  if (card) {
    const buttons = Array.from(
      card.querySelectorAll<HTMLButtonElement>('.history-actions button'),
    ).map((element) => ({
      element,
      label:
        element.getAttribute('aria-label') ||
        element.dataset.tooltip ||
        element.textContent ||
        '',
    }))
    if (!buttons.length) return
    target.value = { kind: 'history', buttons }
  } else {
    const thumbnail = element.closest<HTMLImageElement>(
      '.message-image[data-image-id]',
    )
    const image = thumbnail?.dataset.imageId
      ? workspace.imageMap.get(thumbnail.dataset.imageId)
      : undefined
    if (!image) return
    target.value = { kind: 'chat', image }
  }

  event.preventDefault()
  position.value = { left: event.clientX, top: event.clientY }
  await nextTick()
  const bounds = menu.value?.getBoundingClientRect()
  if (!bounds) return
  position.value = {
    left: Math.max(8, Math.min(event.clientX, innerWidth - bounds.width - 8)),
    top: Math.max(8, Math.min(event.clientY, innerHeight - bounds.height - 8)),
  }
}

function close(event?: Event) {
  if (event?.target instanceof Node && menu.value?.contains(event.target))
    return
  if (event instanceof KeyboardEvent && event.key !== 'Escape') return
  target.value = null
}

function historyAction(button: HTMLButtonElement) {
  target.value = null
  button.click()
}

async function action(kind: 'details' | 'reference' | 'copy' | 'download') {
  const current = target.value
  target.value = null
  if (!current || current.kind !== 'chat') return
  try {
    if (kind === 'details') viewer.open([current.image.src])
    else if (kind === 'reference') await chat.referenceImage(current.image.id)
    else if (kind === 'copy') {
      await copyImage(current.image.src)
      ui.notify('图片已复制')
    } else if (kind === 'download') await downloadImage(current.image.src)
  } catch (error) {
    ui.notify(errorMessage(error), 'error')
  }
}

onMounted(() => {
  document.addEventListener('contextmenu', open)
  document.addEventListener('pointerdown', close)
  window.addEventListener('keydown', close)
  document.addEventListener('scroll', close, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', open)
  document.removeEventListener('pointerdown', close)
  window.removeEventListener('keydown', close)
  document.removeEventListener('scroll', close, true)
})
</script>

<template>
  <div
    v-if="target"
    ref="menu"
    class="image-context-menu"
    role="menu"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @contextmenu.prevent
  >
    <template v-if="target.kind === 'history'">
      <button
        v-for="(button, index) in target.buttons"
        :key="index"
        role="menuitem"
        :disabled="button.element.disabled"
        :class="{
          'is-favorite': button.element.classList.contains('is-favorite'),
          'danger-action':
            button.element.dataset.historyAction === 'delete' ||
            button.element.dataset.generationAction === 'delete-task',
        }"
        @click="historyAction(button.element)"
      >
        {{ button.label }}
      </button>
    </template>
    <template v-else>
      <button role="menuitem" @click="action('details')">查看原图</button>
      <button role="menuitem" @click="action('reference')">引用图片</button>
      <button role="menuitem" @click="action('copy')">复制原图</button>
      <button role="menuitem" @click="action('download')">下载原图</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Message, StoredImage } from '../types/models'
import { renderMarkdown } from '../utils/markdown'
import { formatTime } from '../utils/format'
import { copyText } from '../utils/files'
import { useChatStore } from '../stores/chat'
import { useInterfaceStore } from '../stores/interface'
import { useViewerStore } from '../stores/viewer'
const props = defineProps<{
  message: Message
  images: StoredImage[]
  streaming?: boolean
}>()
const chat = useChatStore()
const ui = useInterfaceStore()
const viewer = useViewerStore()
function previewMarkdownImage(event: MouseEvent) {
  const target = event.target
  if (
    !(target instanceof HTMLImageElement) ||
    !target.classList.contains('markdown-inline-image')
  )
    return
  const content = event.currentTarget as HTMLElement
  const images = Array.from(
    content.querySelectorAll<HTMLImageElement>('.markdown-inline-image'),
  )
  viewer.open(
    images.map((image) => image.src),
    images.indexOf(target),
  )
}
async function copy() {
  await copyText(props.message.content)
  ui.notify('已复制到剪贴板')
}
</script>
<template>
  <article
    class="message"
    :class="[message.role, { streaming }]"
    :data-message-id="message.id"
  >
    <div class="message-avatar">
      {{ message.role === 'assistant' ? 'O' : 'ME' }}
    </div>
    <div class="message-content" @click="previewMarkdownImage">
      <div class="message-meta">
        <span class="message-role">{{
          message.role === 'assistant' ? 'Orbit' : '你'
        }}</span
        ><span class="message-time">{{ formatTime(message.createdAt) }}</span>
      </div>
      <details
        v-if="message.reasoning"
        class="message-reasoning"
        :open="streaming"
      >
        <summary>
          {{ streaming && !message.content ? '正在思考' : '思考过程' }}
        </summary>
        <div
          class="message-reasoning-content markdown-body"
          v-html="renderMarkdown(message.reasoning)"
        ></div>
      </details>
      <div
        class="message-text markdown-body"
        v-html="renderMarkdown(message.content)"
      ></div>
      <div class="message-images" v-if="images.length">
        <button
          v-for="(image, index) in images"
          :key="image.id"
          class="message-image-button"
          aria-label="预览消息图片"
          @click.stop="
            viewer.open(
              images.map((item) => item.src),
              index,
            )
          "
        >
          <img
            class="message-image"
            :src="image.src"
            alt=""
            decoding="async"
            loading="lazy"
          />
        </button>
      </div>
      <div class="message-actions">
        <button
          v-if="message.role === 'user'"
          class="message-action"
          @click="chat.editMessage(message)"
        >
          修改</button
        ><button class="message-action" @click="copy">复制</button
        ><button class="message-action" @click="chat.deleteMessage(message.id)">
          删除
        </button>
      </div>
    </div>
  </article>
</template>

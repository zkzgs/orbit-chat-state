<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { AgentStep, Message, StoredImage } from '../types/models'
import { renderMarkdown } from '../utils/markdown'
import { formatTime } from '../utils/format'
import { copyText } from '../utils/files'
import { agentStepTitle, agentWaitSeconds } from '../api/image-agent.js'
import { useChatStore } from '../stores/chat'
import { useInterfaceStore } from '../stores/interface'
import { useViewerStore } from '../stores/viewer'
import { useWorkspaceStore } from '../stores/workspace'
const props = defineProps<{
  message: Message
  images: StoredImage[]
  streaming?: boolean
}>()
const chat = useChatStore()
const ui = useInterfaceStore()
const viewer = useViewerStore()
const workspace = useWorkspaceStore()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
watch(
  () =>
    Boolean(
      props.streaming &&
        props.message.steps?.some(
          (step) => step.type === 'waiting' && !step.endedAt,
        ),
    ),
  (running) => {
    clearInterval(timer)
    timer = undefined
    if (!running) return
    now.value = Date.now()
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(timer))
const hasSteps = computed(() => Boolean(props.message.steps?.length))
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
function stepBatch(step: AgentStep) {
  return step.batchId
    ? workspace.batches.find((item) => item.id === step.batchId)
    : undefined
}
function stepImages(step: AgentStep) {
  if (step.batchId) return workspace.batchImages(stepBatch(step))
  return workspace.messageImages(step.imageIds || [])
}
function waitLabel(step: AgentStep) {
  return `${agentStepTitle(step)} · ${agentWaitSeconds(step, now.value)} 秒`
}
function stepOpen(index: number) {
  return Boolean(props.streaming && index === (props.message.steps?.length || 0) - 1)
}
function openImage(image: StoredImage, index: number, batch = props.images) {
  const found = workspace.batches.find(
    (item) => item.id === image.batchId || item.imageIds.includes(image.id),
  )
  if (found || image.batchId || image.taskId) {
    const task = workspace.tasks.find(
      (item) => item.id === image.taskId || item.batchId === found?.id,
    )
    const batchIndex = found?.imageIds.indexOf(image.id) ?? index
    ui.openDetails(found, task, Math.max(0, batchIndex), image.id)
    return
  }
  viewer.open(
    batch.map((item) => item.src),
    index,
  )
}
function openStepImage(step: AgentStep, image: StoredImage, index: number) {
  openImage(image, index, stepImages(step))
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
      <div v-if="hasSteps" class="message-steps">
        <section
          v-for="(step, index) in message.steps"
          :key="index"
          class="agent-step"
          :class="'agent-step-' + step.type"
        >
          <details
            v-if="step.type === 'thinking'"
            class="message-reasoning"
            :open="stepOpen(index)"
          >
            <summary>{{ agentStepTitle(step) }}</summary>
            <div
              class="message-reasoning-content markdown-body"
              v-html="renderMarkdown(step.text || '')"
            ></div>
          </details>
          <div
            v-else-if="step.type === 'tool_call' || step.type === 'retry'"
            class="agent-step-tool"
          >
            <div class="agent-step-label">{{ agentStepTitle(step) }}</div>
            <pre v-if="step.prompt" class="agent-step-prompt">{{
              step.prompt
            }}</pre>
          </div>
          <div v-else-if="step.type === 'waiting'" class="agent-step-waiting">
            <span
              v-if="!step.endedAt"
              class="agent-activity-spinner"
              aria-hidden="true"
            ></span>
            <span data-step-waiting>{{ waitLabel(step) }}</span>
          </div>
          <div v-else-if="step.type === 'image'" class="agent-step-image">
            <div class="agent-step-label">{{ agentStepTitle(step) }}</div>
            <div v-if="step.error && !stepImages(step).length" class="message-error">
              {{ step.error }}
            </div>
            <div
              v-else-if="step.batchId && !stepBatch(step)"
              class="message-images"
            >
              <div class="message-image-missing">已删除</div>
            </div>
            <div v-else-if="stepImages(step).length" class="message-images">
              <button
                v-for="(image, imageIndex) in stepImages(step)"
                :key="image.id"
                class="message-image-button"
                aria-label="预览消息图片"
                @click.stop="openStepImage(step, image, imageIndex)"
              >
                <img
                  class="message-image"
                  v-image-source.full="image.src"
                  alt=""
                  :data-image-id="image.id"
                  draggable="false"
                  decoding="async"
                  loading="lazy"
                />
              </button>
            </div>
          </div>
          <div
            v-else-if="step.type === 'summary'"
            class="message-text markdown-body"
            v-html="renderMarkdown(step.text || '')"
          ></div>
        </section>
      </div>
      <details
        v-else-if="message.reasoning"
        class="message-reasoning"
        :open="streaming"
      >
        <summary>
          {{
            streaming && !message.content
              ? chat.agentActivity?.status || '正在思考'
              : '思考过程'
          }}
        </summary>
        <div
          class="message-reasoning-content markdown-body"
          v-html="renderMarkdown(message.reasoning)"
        ></div>
      </details>
      <div
        v-if="!hasSteps || !message.steps?.some((step) => step.type === 'summary')"
        class="message-text markdown-body"
        v-html="renderMarkdown(message.content)"
      ></div>
      <div v-if="message.error" class="message-error" role="alert">
        请求失败: {{ message.error }}
      </div>
      <div v-if="message.files?.length" class="chat-files">
        <div v-for="file in message.files" :key="file.id" class="chat-file">
          <span>PDF</span><span class="chat-file-name">{{ file.name }}</span>
        </div>
      </div>
      <div class="message-images" v-if="!hasSteps && images.length">
        <button
          v-for="(image, index) in images"
          :key="image.id"
          class="message-image-button"
          aria-label="预览消息图片"
          @click.stop="openImage(image, index)"
        >
          <img
            class="message-image"
            v-image-source.full="image.src"
            alt=""
            :data-image-id="image.id"
            draggable="false"
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

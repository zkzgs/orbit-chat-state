<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryStore, type HistoryCard } from '../stores/history'
import { formatDuration, formatTime } from '../utils/format'
import HistoryAction from '../components/HistoryAction.vue'
import { useElapsed } from '../composables/useElapsed'
import { useWorkspaceStore } from '../stores/workspace'
const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const props = defineProps<{ card: HistoryCard; selected: boolean }>()
const workspace = useWorkspaceStore()
const history = useHistoryStore()
const isCover = computed(() =>
  Boolean(
    props.card.image &&
    history.effectiveCoverId(history.folderId) === props.card.image.id,
  ),
)
const isAutoCover = computed(
  () =>
    isCover.value &&
    workspace.favoriteFolders.find((folder) => folder.id === history.folderId)
      ?.coverImageId === undefined,
)
const favorite = computed(() =>
  props.card.kind === 'image'
    ? props.card.favoriteImageIds.some(
        (id) => workspace.imageFavoriteFolders.get(id)?.length,
      )
    : Boolean(
        workspace.tasks.find((task) => task.id === props.card.taskId)
          ?.favoriteFolderIds?.length,
      ),
)
const canRetry = computed(
  () =>
    Boolean(
      props.card.taskId &&
      workspace.tasks.some(
        (task) => task.id === props.card.taskId && task.status !== 'running',
      ),
    ) &&
    (['error', 'partial'].includes(props.card.status) ||
      (props.card.status === 'success' &&
        workspace.state.settings.alwaysShowRetryButton)),
)
const elapsed = useElapsed(
  () => props.card.startedAt,
  () => props.card.finishedAt || props.card.startedAt + props.card.durationMs,
  () => props.card.status === 'running',
)
const emit = defineEmits<{
  open: []
  selection: [checked: boolean]
  action: [action: string]
}>()
const statusLabel = computed(
  () =>
    ({
      running: '进行中',
      success: '已完成',
      partial: '部分完成',
      error: '失败',
    })[props.card.status],
)
const elapsedText = computed(() => {
  const duration = formatDuration(elapsed.value)
  if (props.card.kind === 'image')
    return `${formatTime(props.card.createdAt)} · ${duration} · 数量 ${props.card.images.length}${props.card.status === 'partial' ? ' · 部分完成' : ''}`
  if (props.card.status === 'running') return `已用时 ${duration} · 进行中`
  return `${duration} · ${statusLabel.value}${
    props.card.images.length ? ` · 数量 ${props.card.images.length}` : ''
  }`
})
</script>
<template>
  <article
    :class="[
      card.kind === 'image'
        ? 'history-item generation-record'
        : 'generation-task-card',
      card.status,
      {
        selected,
        'group-card': card.isGroup,
        'single-card': card.kind === 'image' && !card.isGroup,
      },
    ]"
    :data-history-key="card.key"
    :data-task-id="card.taskId"
    :data-history-id="card.batchId"
    :data-search-text="`${card.title} ${card.detail}`.toLocaleLowerCase()"
    :data-status="card.status"
    @click="card.kind === 'task' && emit('open')"
  >
    <input
      v-if="card.key"
      class="history-select"
      type="checkbox"
      :data-history-key="card.key"
      :checked="selected"
      :aria-label="card.kind === 'image' ? '选择历史图片' : '选择失败任务'"
      @click.stop
      @change="emit('selection', ($event.target as HTMLInputElement).checked)"
    /><button
      v-if="card.kind === 'image'"
      class="history-image-button"
      :data-history-id="card.batchId"
      :data-history-image-index="card.index"
      aria-label="查看生成图片"
      @click="emit('open')"
    >
      <div v-if="card.isGroup" class="history-item-thumb-grid">
        <img
          v-for="image in card.images.slice(0, 4)"
          :key="image.id"
          :src="placeholder"
          :data-image-id="image.id"
          alt=""
          draggable="false"
          decoding="async"
          loading="lazy"
        />
      </div>
      <img
        v-else
        :key="card.image?.id"
        :src="placeholder"
        :data-image-id="card.image?.id"
        alt=""
        draggable="false"
        decoding="async"
        loading="lazy"
      />
    </button>
    <div v-else class="generation-task-visual">
      <span
        v-if="card.status === 'running'"
        class="generation-record-spinner"
        aria-hidden="true"
      ></span>
      <span v-else class="generation-task-symbol">{{
        card.status === 'error' ? '!' : '○'
      }}</span
      ><strong>{{ statusLabel }}</strong
      ><span>{{ card.detail }}</span>
    </div>
    <div class="history-item-info">
      <div class="history-item-prompt">{{ card.title }}</div>
      <time class="history-item-time"
        ><template v-if="card.kind === 'image'"
          >{{ formatTime(card.createdAt) }} · {{ formatDuration(elapsed) }} ·
          <span class="history-item-batch">数量 {{ card.images.length }}</span
          >{{ card.status === 'partial' ? ' · 部分完成' : '' }}</template
        ><template v-else>{{ elapsedText }}</template></time
      >
    </div>
    <div class="history-actions" @click.stop>
      <button
        v-if="card.image && history.library === 'favorites' && history.folderId"
        type="button"
        class="history-action-button favorite-cover-button"
        :class="{ 'is-cover': isCover, 'is-auto-cover': isAutoCover }"
        :aria-label="isCover ? '取消封面' : '设为封面'"
        :data-tooltip="
          isCover
            ? isAutoCover
              ? '自动封面 · 取消封面'
              : '取消封面'
            : '设为封面'
        "
        data-history-action="cover"
        @click="emit('action', 'cover')"
      >
        <span class="cover-label-idle">{{
          isCover ? '封面' : '设为封面'
        }}</span>
        <span class="cover-label-hover">{{
          isCover ? '取消封面' : '设为封面'
        }}</span>
      </button>
      <template v-if="card.kind === 'image'"
        ><HistoryAction
          data-history-action="favorite"
          action="favorite"
          label="收藏到文件夹"
          :active="favorite"
          @click="emit('action', 'favorite')" /><HistoryAction
          data-history-action="config"
          action="config"
          label="复制配置"
          @click="emit('action', 'config')" /><HistoryAction
          :data-history-action="card.isGroup ? 'download-all' : 'download'"
          :action="card.isGroup ? 'download-all' : 'download'"
          :label="card.isGroup ? '下载全部' : '下载原图'"
          @click="
            emit('action', card.isGroup ? 'download-all' : 'download')
          " /><HistoryAction
          v-if="canRetry"
          data-generation-action="retry-task"
          action="retry-task"
          label="重试任务"
          @click="emit('action', 'retry-task')" /><HistoryAction
          data-history-action="edit"
          action="edit"
          label="编辑输出"
          @click="emit('action', 'edit')" /><HistoryAction
          data-history-action="delete"
          action="delete"
          label="删除生成记录"
          @click="emit('action', 'delete')" /></template
      ><template v-else
        ><HistoryAction
          v-if="card.taskId"
          data-generation-action="favorite-task"
          action="favorite"
          label="收藏任务"
          :active="favorite"
          @click="emit('action', 'favorite-task')" /><HistoryAction
          v-if="card.status !== 'running'"
          data-generation-action="reuse-task"
          action="config"
          label="恢复配置"
          @click="emit('action', 'reuse-task')" /><HistoryAction
          v-if="canRetry"
          data-generation-action="retry-task"
          action="retry-task"
          label="重试任务"
          @click="emit('action', 'retry-task')" /><HistoryAction
          v-if="card.status !== 'running'"
          data-generation-action="delete-task"
          action="delete"
          label="删除生成记录"
          @click="emit('action', 'delete-task')"
      /></template>
    </div>
  </article>
</template>

<script setup lang="ts">
import HistoryAction from '../components/HistoryAction.vue'

defineProps<{
  folder: {
    id: string
    name: string
    isDefault: boolean
    imageCount: number
    taskCount: number
  }
}>()
defineEmits<{ open: []; action: [action: string] }>()
</script>
<template>
  <article
    class="favorite-folder-card"
    :class="{ 'is-default': folder.isDefault }"
    :data-search-text="folder.name.toLocaleLowerCase()"
  >
    <button
      class="favorite-folder-open"
      type="button"
      :aria-label="`打开收藏夹 ${folder.name}`"
      @click="$emit('open')"
    >
      <span class="favorite-folder-visual"
        ><svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
          <path d="M3.5 8.5h17" /></svg
      ></span>
      <span class="favorite-folder-info"
        ><span class="favorite-folder-name">{{ folder.name }}</span
        ><span class="favorite-folder-count"
          >{{ folder.imageCount }} 张图片 · {{ folder.taskCount }} 条任务{{
            folder.isDefault ? ' · 默认' : ''
          }}</span
        ></span
      >
    </button>
    <div class="favorite-folder-actions">
      <HistoryAction
        action="default"
        label="设为默认收藏夹"
        :active="folder.isDefault"
        @click="$emit('action', 'default')"
      />
      <HistoryAction
        action="rename"
        label="重命名收藏夹"
        @click="$emit('action', 'rename')"
      />
      <HistoryAction
        action="delete"
        label="删除收藏夹"
        @click="$emit('action', 'delete')"
      />
    </div>
  </article>
</template>

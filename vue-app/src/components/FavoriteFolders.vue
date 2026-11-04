<script setup lang="ts">
import { computed } from 'vue'
import { useInterfaceStore } from '../stores/interface'
import { useHistoryStore } from '../stores/history'
import { useWorkspaceStore } from '../stores/workspace'
import HistoryAction from './HistoryAction.vue'
const ui = useInterfaceStore()
const history = useHistoryStore()
const workspace = useWorkspaceStore()
const isManaging = computed(
  () => !ui.favorite.imageIds.length && !ui.favorite.taskIds.length,
)
const dialogTitle = computed(() =>
  ui.favorite.imageIds.length
    ? `收藏 ${ui.favorite.imageIds.length} 张图片`
    : ui.favorite.taskIds.length
      ? `收藏 ${ui.favorite.taskIds.length} 条任务`
      : '管理收藏夹',
)
function handleFolderRowClick(event: MouseEvent, folderId: string) {
  if (
    isManaging.value ||
    (event.target as HTMLElement).closest('.favorite-folder-row-actions, input')
  )
    return
  const selected = ui.favorite.selected.includes(folderId)
  ui.favorite.selected = selected
    ? ui.favorite.selected.filter((id) => id !== folderId)
    : [...ui.favorite.selected, folderId]
}
</script>
<template>
  <div
    id="favoriteFolderBackdrop"
    class="modal-backdrop"
    :hidden="!ui.favorite.open"
    @click.self="ui.favorite.open = false"
  >
    <section
      class="settings-modal favorite-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="favoriteDialogTitle"
    >
      <header class="modal-header">
        <div>
          <div class="eyebrow">Favorites</div>
          <h2 id="favoriteDialogTitle">{{ dialogTitle }}</h2>
        </div>
        <button
          id="closeFavoriteFolderDialog"
          class="icon-button"
          aria-label="关闭"
          @click="ui.favorite.open = false"
        >
          ×
        </button>
      </header>
      <div class="favorite-dialog-body">
        <div id="favoriteFolderChoices" class="favorite-folder-list">
          <div
            v-for="folder in workspace.favoriteFolders"
            :key="folder.id"
            class="favorite-folder-row"
            @click="handleFolderRowClick($event, folder.id)"
          >
            <input
              v-if="!isManaging"
              v-model="ui.favorite.selected"
              type="checkbox"
              :value="folder.id"
              :aria-label="`收藏到 ${folder.name}`"
            />
            <span class="favorite-folder-row-name">{{ folder.name }}</span>
            <small>{{ folder.isDefault ? '默认' : '' }}</small>
            <span class="favorite-folder-row-actions">
              <HistoryAction
                action="default"
                label="设为默认收藏夹"
                :active="folder.isDefault"
                @click.stop="history.folderAction('default', folder.id)"
              />
              <HistoryAction
                action="rename"
                label="重命名收藏夹"
                @click.stop="history.folderAction('rename', folder.id)"
              />
              <HistoryAction
                action="delete"
                label="删除收藏夹"
                @click.stop="history.folderAction('delete', folder.id)"
              />
            </span>
          </div>
        </div>
        <form
          id="favoriteFolderCreateForm"
          class="favorite-folder-create"
          @submit.prevent="history.createFolder"
        >
          <input
            id="favoriteFolderName"
            v-model="ui.favorite.name"
            type="text"
            maxlength="40"
            placeholder="新建收藏夹"
            aria-label="收藏夹名称"
          /><button class="secondary-button" type="submit">新建</button>
        </form>
      </div>
      <footer class="modal-footer">
        <span></span>
        <div>
          <button
            id="cancelFavoriteFolderDialog"
            class="secondary-button"
            type="button"
            @click="ui.favorite.open = false"
          >
            取消</button
          ><button
            id="saveFavoriteFolderChoices"
            class="primary-button"
            type="button"
            @click="history.saveFavorite"
          >
            保存
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

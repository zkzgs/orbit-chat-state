<script setup lang="ts">
import { useInterfaceStore } from '../stores/interface'
import { useHistoryStore } from '../stores/history'
import { useWorkspaceStore } from '../stores/workspace'
const ui = useInterfaceStore()
const history = useHistoryStore()
const workspace = useWorkspaceStore()
</script>
<template>
  <div
    id="favoriteDeleteBackdrop"
    class="modal-backdrop"
    :hidden="!ui.favoriteDelete.open"
    @click.self="ui.favoriteDelete.open = false"
  >
    <section
      class="settings-modal favorite-delete-modal"
      role="dialog"
      aria-modal="true"
    >
      <header class="modal-header">
        <h2 id="favoriteDeleteTitle">删除收藏夹</h2>
        <button
          id="closeFavoriteDelete"
          class="icon-button"
          aria-label="关闭"
          @click="ui.favoriteDelete.open = false"
        >
          ×
        </button>
      </header>
      <div class="favorite-delete-body">
        <p id="favoriteDeleteMessage">
          删除收藏夹“{{
            workspace.favoriteFolders.find(
              (folder) => folder.id === ui.favoriteDelete.folderId,
            )?.name
          }}”?
        </p>
        <label class="favorite-delete-choice"
          ><input
            id="deleteFavoriteImages"
            v-model="ui.favoriteDelete.deleteImages"
            type="checkbox"
          /><span>同时删除收藏夹中的图片</span></label
        >
      </div>
      <footer class="modal-footer">
        <button
          id="cancelFavoriteDelete"
          class="secondary-button"
          @click="ui.favoriteDelete.open = false"
        >
          取消</button
        ><button
          id="confirmFavoriteDelete"
          class="primary-button favorite-delete-confirm"
          @click="history.confirmDeleteFolder"
        >
          确认删除
        </button>
      </footer>
    </section>
  </div>
</template>

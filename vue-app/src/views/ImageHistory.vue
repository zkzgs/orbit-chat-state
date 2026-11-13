<script setup lang="ts">
import { ref } from 'vue'
import { useHistoryStore } from '../stores/history'
import { useHistorySelection } from '../composables/useHistorySelection'
import { useVirtualGrid } from '../composables/useVirtualGrid'
import HistoryCard from './HistoryCard.vue'
import FavoriteFolderCard from './FavoriteFolderCard.vue'
import CustomSelect from '../components/CustomSelect.vue'
const history = useHistoryStore()
const list = ref<HTMLElement | null>(null)
const { visible: cards, range } = useVirtualGrid(list, () =>
  history.isFolderIndex ? [] : history.cards,
)
useHistorySelection(list)

async function deleteCards(items: Parameters<typeof history.deleteCards>[0]) {
  return history.deleteCards(items)
}

async function handleCardAction(
  action: string,
  card: (typeof history.cards)[number],
) {
  if (action === 'delete' || action === 'delete-task') {
    await deleteCards([card])
    return
  }
  await history.action(action, card)
}
</script>
<template>
  <section id="imageHistorySection" class="image-history-section">
    <div class="history-heading">
      <div>
        <h3 id="imageHistoryTitle">
          {{ history.title }}
          <span class="history-count">{{
            history.isFolderIndex
              ? history.folders.length
              : history.cards.length
          }}</span>
        </h3>
      </div>
      <div class="history-heading-actions">
        <div id="historyLibraryToggle" class="history-library-toggle">
          <button
            type="button"
            :class="{ active: history.library === 'history' }"
            data-history-library="history"
            @click="history.setLibrary('history')"
          >
            生成记录</button
          ><button
            type="button"
            :class="{ active: history.library === 'favorites' }"
            data-history-library="favorites"
            @click="history.setLibrary('favorites')"
          >
            收藏夹
          </button>
        </div>
        <button
          id="favoriteFolderBack"
          class="secondary-button favorite-folder-back"
          :hidden="!history.folderId"
          @click="history.openFolder('')"
        >
          返回收藏夹</button
        ><button
          id="newFavoriteFolder"
          class="secondary-button favorite-folder-new"
          :hidden="!history.isFolderIndex"
          @click="history.openFavorite()"
        >
          新建收藏夹
        </button>
        <div
          id="historyViewToggle"
          class="history-view-toggle"
          :hidden="history.library === 'favorites' || !history.hasGroups"
        >
          <button
            data-history-view="group"
            :class="{ active: history.mode === 'group' }"
            @click="history.setMode('group')"
          >
            按组</button
          ><button
            data-history-view="single"
            :class="{ active: history.mode === 'single' }"
            @click="history.setMode('single')"
          >
            按单图
          </button>
        </div>
      </div>
    </div>
    <div class="history-filterbar" id="historyFilterbar">
      <label class="history-search-wrap"
        ><svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" /></svg
        ><input
          id="historySearch"
          class="history-search"
          v-model="history.query"
          type="search"
          :placeholder="history.isFolderIndex ? '搜索收藏夹' : '搜索提示词'"
          autocomplete="off" /></label
      ><CustomSelect
        id="historyStatusFilter"
        v-model="history.status"
        :hidden="history.isFolderIndex"
        :options="[
          { value: 'all', label: '全部状态' },
          { value: 'success', label: '已完成' },
          { value: 'partial', label: '部分完成' },
          { value: 'error', label: '失败' },
          { value: 'running', label: '进行中' },
        ]"
      />
    </div>
    <div id="imageHistory" ref="list" class="image-history" aria-live="polite">
      <template v-if="history.isFolderIndex"
        ><FavoriteFolderCard
          v-for="folder in history.folders"
          :key="folder.id"
          :folder="folder"
          @open="history.openFolder(folder.id)"
          @action="history.folderAction($event, folder.id)" /></template
      ><template v-else
        ><div
          v-if="range.before > 0"
          class="virtual-grid-spacer"
          :style="{ height: range.before + 'px' }"
          aria-hidden="true"
        ></div>
        <HistoryCard
          v-for="card in cards"
          :key="card.id"
          :card="card"
          :selected="history.selected.has(card.key)"
          @open="history.openCard(card)"
          @selection="history.toggleSelection(card.key, $event)"
          @action="handleCardAction($event, card)" />
        <div
          v-if="range.after > 0"
          class="virtual-grid-spacer"
          :style="{ height: range.after + 'px' }"
          aria-hidden="true"
        ></div
      ></template>
      <div
        class="history-empty"
        :class="{ 'is-studio-empty': history.library === 'history' }"
        :hidden="
          history.isFolderIndex
            ? history.folders.length > 0
            : history.cards.length > 0
        "
      >
        <div v-if="history.library === 'history'" class="image-copy">
          <div class="welcome-kicker">
            <span class="sparkle">✦</span> Image studio
          </div>
          <h2>把描述, 变成<br /><em>一张画面</em></h2>
        </div>
        <p>
          {{
            history.isFolderIndex
              ? '没有匹配的收藏夹'
              : history.library === 'favorites'
                ? '这个收藏夹里还没有内容'
                : '没有匹配的生成记录'
          }}
        </p>
      </div>
    </div>
    <div
      id="historySelectionBar"
      class="history-selection-bar"
      :hidden="!history.selected.size"
    >
      <span id="historySelectionCount" class="selection-count"
        >已选择 {{ history.selected.size }} 项</span
      >
      <div class="selection-actions">
        <button id="historyClearSelection" @click="history.selected.clear()">
          取消选择</button
        ><button id="historySelectAll" @click="history.selectAll">全选</button
        ><button id="historyInvertSelection" @click="history.invertSelection">
          反选</button
        ><button id="historyDownloadSelected" @click="history.downloadSelected">
          下载</button
        ><button
          id="historyDeleteSelected"
          class="danger-action"
          @click="
            deleteCards(
              history.cards.filter((card) => history.selected.has(card.key)),
            )
          "
        >
          删除
        </button>
      </div>
    </div>
  </section>
</template>

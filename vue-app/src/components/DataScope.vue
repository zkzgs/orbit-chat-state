<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceData } from '../composables/useWorkspaceData'
import { useInterfaceStore } from '../stores/interface'
const ui = useInterfaceStore()
const data = useWorkspaceData()
const title = computed(() =>
  ui.dataScope.action === 'export' ? '选择导出范围' : '选择清除范围',
)
const description = computed(() =>
  ui.dataScope.action === 'export'
    ? '请选择要写入 JSON 文件的数据范围。'
    : '请选择本次要清除的数据范围，确认后不可撤销。',
)
</script>

<template>
  <div
    :hidden="!ui.dataScope.open"
    class="modal-backdrop"
    id="dataScopeBackdrop"
  >
    <section
      class="settings-modal data-scope-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dataScopeTitle"
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Data scope</div>
          <h2 id="dataScopeTitle">{{ title }}</h2>
        </div>
        <button
          class="icon-button"
          id="closeDataScope"
          title="关闭"
          aria-label="关闭"
          @click="ui.dataScope.open = false"
        >
          ×
        </button>
      </div>
      <div class="data-scope-body">
        <p id="dataScopeDescription">{{ description }}</p>
        <div class="data-scope-options">
          <button
            class="data-scope-option"
            data-data-scope="chat"
            @click="data.choose('chat')"
            type="button"
          >
            对话工作区</button
          ><button
            class="data-scope-option"
            data-data-scope="image"
            @click="data.choose('image')"
            type="button"
          >
            生图工作区</button
          ><button
            class="data-scope-option"
            data-data-scope="workspace"
            @click="data.choose('workspace')"
            type="button"
          >
            全部工作区</button
          ><button
            class="data-scope-option"
            data-data-scope="config"
            @click="data.choose('config')"
            type="button"
          >
            配置</button
          ><button
            class="data-scope-option"
            data-data-scope="all"
            @click="data.choose('all')"
            type="button"
          >
            全部数据
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <span></span>
        <div>
          <button
            class="secondary-button"
            id="cancelDataScope"
            type="button"
            @click="ui.dataScope.open = false"
          >
            取消
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceData } from '../composables/useWorkspaceData'
import { useInterfaceStore } from '../stores/interface'
const ui = useInterfaceStore()
const data = useWorkspaceData()
const selected = ref<string[]>([])
watch(
  () => ui.dataScope.open,
  (open) => {
    if (open)
      selected.value =
        ui.dataScope.action === 'export' ? ['chat', 'image', 'config'] : []
  },
)
function confirmSelection() {
  const [chat, image, config] = ['chat', 'image', 'config'].map((key) =>
    selected.value.includes(key),
  )
  const scope =
    chat && image && config
      ? 'all'
      : chat && image
        ? 'workspace'
        : chat && config
          ? 'chat-config'
          : image && config
            ? 'image-config'
            : chat
              ? 'chat'
              : image
                ? 'image'
                : 'config'
  if (selected.value.length) void data.choose(scope)
}
const title = computed(() =>
  ui.dataScope.action === 'export' ? '选择导出范围' : '选择清除范围',
)
const description = computed(() =>
  ui.dataScope.action === 'export'
    ? '请选择要写入 ZIP 备份的数据范围。'
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
          <label
            v-for="option in [
              { value: 'chat', label: '对话' },
              { value: 'image', label: '生图' },
              { value: 'config', label: '配置' },
            ]"
            :key="option.value"
            class="data-scope-option"
          >
            <input
              type="checkbox"
              v-model="selected"
              :value="option.value"
              :data-data-scope="option.value"
            />
            {{ option.label }}
          </label>
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
          <button
            id="confirmDataScope"
            class="primary-button"
            type="button"
            :disabled="!selected.length"
            @click="confirmSelection"
          >
            确认
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  agentImageFields,
  resolveAgentImageOptions,
} from '../api/image-agent.js'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useSettingsStore } from '../stores/settings'
import CustomSelect from './CustomSelect.vue'
import ModelInput from './ModelInput.vue'

const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const settings = useSettingsStore()
const automatic = ref(false)
const model = ref('')
const draft = reactive<Record<string, string | number>>({})
const imageModels = computed(() => [
  ...new Set([model.value, ...workspace.modelCatalog.image].filter(Boolean)),
])
const fields = computed(() =>
  agentImageFields(
    workspace.state.settings.imageProvider,
    imageModels.value,
    model.value,
  ),
)
const parameterFields = computed(() =>
  fields.value.filter((field) => field.key !== 'model'),
)
function open() {
  if (!workspace.state.settings.chatImageTools) return
  automatic.value = workspace.state.settings.imageAgentAutoParameters
  model.value = workspace.state.settings.imageModel
  for (const field of parameterFields.value)
    draft[field.key] =
      workspace.state.settings.imageOptions[
        field.key as keyof typeof workspace.state.settings.imageOptions
      ] ?? field.value
  ui.agentImageSettingsOpen = true
}
function visible(key: string) {
  if (['resolution', 'ratio'].includes(key)) return draft.sizeMode === 'ratio'
  if (['width', 'height'].includes(key)) return draft.sizeMode === 'custom'
  if (key === 'compression')
    return ['jpeg', 'webp'].includes(String(draft.format))
  return true
}
function save() {
  try {
    const selectedModel = model.value.trim()
    if (!selectedModel) throw new Error('请选择生图模型')
    workspace.state.settings.imageModel = selectedModel
    if (!automatic.value) {
      const options = resolveAgentImageOptions(
        workspace.state.settings.imageProvider,
        { ...draft, model: selectedModel },
        [...new Set([...imageModels.value, selectedModel])],
        selectedModel,
      )
      Object.assign(
        workspace.state.settings.imageOptions,
        Object.fromEntries(
          parameterFields.value.map((field) => [field.key, options[field.key]]),
        ),
      )
    }
    workspace.state.settings.imageAgentAutoParameters = automatic.value
    ui.agentImageSettingsOpen = false
  } catch (error) {
    ui.notify((error as Error).message, 'error')
  }
}
</script>

<template>
  <button
    id="agentImageSettings"
    class="agent-settings-button"
    type="button"
    :disabled="!workspace.state.settings.chatImageTools"
    aria-haspopup="dialog"
    aria-controls="agentImageSettingsBackdrop"
    @click="open"
  >
    生图参数<span v-if="workspace.state.settings.imageAgentAutoParameters">
      · AI</span
    >
  </button>
  <Teleport to="body">
    <div
      :hidden="!ui.agentImageSettingsOpen"
      class="modal-backdrop"
      id="agentImageSettingsBackdrop"
    >
      <section
        class="settings-modal agent-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agentImageSettingsTitle"
      >
        <div class="modal-header">
          <h2 id="agentImageSettingsTitle">Agent 生图参数</h2>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭"
            @click="ui.agentImageSettingsOpen = false"
          >
            ×
          </button>
        </div>
        <div class="settings-scroll">
          <label class="field-label">
            默认生图模型
            <ModelInput
              id="agentImageModel"
              v-model="model"
              :models="workspace.modelCatalog.image"
              label="Agent 生图模型"
              refresh
              :refreshing="settings.loadingModels.image"
              @refresh="settings.loadModels('image', false)"
            />
            <small class="field-help"
              >自动模式下, AI 可从已获取模型中选择其他模型</small
            >
          </label>
          <label class="toggle-row">
            <span
              ><strong>由 AI 决定生图参数</strong>
              <small
                >开启后, AI 可从当前模型和已获取模型中选择模型与参数</small
              ></span
            >
            <input
              id="agentImageAutoParameters"
              type="checkbox"
              v-model="automatic"
            /><span class="toggle-ui"></span>
          </label>
          <fieldset class="agent-parameter-grid" :disabled="automatic">
            <template v-for="field in parameterFields" :key="field.key">
              <label v-if="visible(field.key)" class="field-label">
                {{ field.label }}
                <CustomSelect
                  v-if="field.options"
                  :id="`agentImage-${field.key}`"
                  :model-value="String(draft[field.key])"
                  :options="field.options"
                  :disabled="automatic"
                  @update:model-value="draft[field.key] = $event"
                />
                <input
                  v-else
                  :id="`agentImage-${field.key}`"
                  type="number"
                  :value="draft[field.key]"
                  :min="field.min"
                  :max="field.max"
                  step="1"
                  @input="
                    draft[field.key] = Number(
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
            </template>
          </fieldset>
        </div>
        <div class="modal-footer">
          <button
            class="secondary-button"
            type="button"
            id="cancelAgentImageSettings"
            @click="ui.agentImageSettingsOpen = false"
          >
            取消
          </button>
          <button
            class="primary-button"
            type="button"
            id="saveAgentImageSettings"
            @click="save"
          >
            保存
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

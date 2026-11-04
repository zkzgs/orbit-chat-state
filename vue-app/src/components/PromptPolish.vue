<script setup lang="ts">
import { usePromptTemplatesStore } from '../stores/prompt-templates'
import { inputFiles, pastedImages } from '../utils/events'
import ReferenceImages from './ReferenceImages.vue'
import PromptEditor from './PromptEditor.vue'
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import CustomSelect from './CustomSelect.vue'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const templates = usePromptTemplatesStore()
const sourceEditor = ref<InstanceType<typeof PromptEditor> | null>(null)
const instructionEditor = ref<InstanceType<typeof PromptEditor> | null>(null)
const activeEditor = ref<'source' | 'instruction'>('source')
watch(
  () => ui.polishOpen,
  (open) => {
    if (open) activeEditor.value = 'source'
  },
)
function mention(kind: 'generation' | 'polish', index: number) {
  if (kind === 'generation' && !templates.polish.useGenerationReferences) {
    ui.notify('请先勾选“润色时分析这组图片”', 'error')
    return
  }
  if (kind === 'polish')
    void instructionEditor.value?.insertReference(
      templates.polish.generationReferences.length + index,
    )
  else
    void (
      activeEditor.value === 'source'
        ? sourceEditor.value
        : instructionEditor.value
    )?.insertReference(index)
}
function paste(event: ClipboardEvent, kind: 'generation' | 'polish') {
  const files = pastedImages(event)
  if (!files.length) return
  event.preventDefault()
  void templates.addPolishReferences(files, kind)
}
const mentionImages = computed(() => [
  ...templates.polish.generationReferences,
  ...templates.polish.references,
])
const mentionLabels = computed(() => [
  ...templates.polish.generationReferences.map((_, index) =>
    templates.polish.useGenerationReferences ? '@生成参考图' + (index + 1) : '',
  ),
  ...templates.polish.references.map((_, index) => '@润色参考图' + (index + 1)),
])
</script>

<template>
  <div
    :hidden="!ui.polishOpen"
    class="modal-backdrop"
    id="promptPolishBackdrop"
  >
    <section
      class="settings-modal polish-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promptPolishTitle"
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Prompt assistant</div>
          <h2 id="promptPolishTitle">润色生图关键词</h2>
          <p class="modal-subtitle">
            生成参考图随结果带回生图面板, 润色参考图仅用于生成关键词
          </p>
        </div>
        <button
          class="icon-button"
          id="closePromptPolish"
          title="关闭润色"
          aria-label="关闭润色"
          @click="templates.closePolish()"
        >
          ×
        </button>
      </div>
      <div class="polish-body">
        <div class="field-label">
          <label for="polishSourcePrompt">当前关键词</label>
          <PromptEditor
            ref="sourceEditor"
            id="polishSourcePrompt"
            v-model="templates.polish.source"
            :images="templates.polish.generationReferences"
            :labels="
              mentionLabels.slice(
                0,
                templates.polish.generationReferences.length,
              )
            "
            strict-mentions
            :mentions-enabled="templates.polish.useGenerationReferences"
            @focus="activeEditor = 'source'"
            @paste="paste($event, 'generation')"
            @drop="templates.addPolishReferences($event, 'generation')"
          />
        </div>
        <div class="profile-manager polish-template-manager">
          <label class="profile-select-label"
            >润色模板<CustomSelect
              id="polishTemplateSelect"
              aria-label="选择润色模板"
              :model-value="
                workspace.state.settings.activeImagePolishTemplateId
              "
              :options="[
                { value: '', label: '临时模板（未保存）' },
                ...workspace.state.settings.imagePolishTemplates.map(
                  (template) => ({ value: template.id, label: template.name }),
                ),
              ]"
              @change="templates.selectPolish($event)"
          /></label>
          <div class="profile-actions">
            <button
              class="secondary-button"
              id="savePolishTemplate"
              type="button"
              @click="templates.savePolish()"
            >
              另存为</button
            ><button
              :disabled="!workspace.state.settings.activeImagePolishTemplateId"
              class="secondary-button"
              id="updatePolishTemplate"
              type="button"
              @click="templates.savePolish(true)"
            >
              更新</button
            ><button
              :disabled="!workspace.state.settings.activeImagePolishTemplateId"
              class="secondary-button profile-delete"
              id="deletePolishTemplate"
              type="button"
              title="删除当前润色模板"
              aria-label="删除当前润色模板"
              @click="templates.deletePolish()"
            >
              ×
            </button>
          </div>
          <small class="profile-help"
            >模板保存润色要求和润色参考图, 不保存生成参考图</small
          >
        </div>
        <div class="polish-reference-groups">
          <div class="polish-reference-group">
            <div class="polish-reference-row">
              <div class="polish-reference-heading">
                <strong>生成参考图</strong
                ><span
                  class="panel-label-hint"
                  id="polishGenerationReferenceHint"
                  >{{
                    templates.polish.generationReferences.length
                      ? `${templates.polish.generationReferences.length} 张参考图`
                      : '未添加参考图'
                  }}</span
                >
              </div>
              <div class="reference-upload-actions">
                <label class="reference-upload"
                  ><span>⊕</span> 添加<input
                    type="file"
                    id="polishGenerationReferenceUpload"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    @change="
                      templates.addPolishReferences(
                        inputFiles($event),
                        'generation',
                      )
                    " /></label
                ><button
                  class="reference-clear"
                  id="clearPolishGenerationReferences"
                  type="button"
                  :disabled="!templates.polish.generationReferences.length"
                  @click="templates.clearReferences('generation')"
                >
                  清空
                </button>
              </div>
            </div>
            <label class="polish-reference-toggle"
              ><input
                v-model="templates.polish.useGenerationReferences"
                type="checkbox"
                id="polishUseGenerationReferences"
              /><span>润色时分析这组图片</span></label
            >
            <ReferenceImages
              id="polishGenerationReferencePreview"
              :images="templates.polish.generationReferences"
              label="生成参考图"
              @mention="mention('generation', $event)"
              @remove="templates.removeReference('generation', $event)"
              @replace="
                (index, file) =>
                  templates.replaceReference('generation', index, file)
              "
              @move="
                (from, to) => templates.moveReference('generation', from, to)
              "
            />
          </div>
          <div class="polish-reference-group">
            <div class="polish-reference-row">
              <div class="polish-reference-heading">
                <strong>润色参考图</strong
                ><span class="panel-label-hint" id="polishReferenceHint">{{
                  templates.polish.references.length
                    ? `${templates.polish.references.length} 张参考图`
                    : '未添加参考图'
                }}</span>
              </div>
              <div class="reference-upload-actions">
                <label class="reference-upload"
                  ><span>⊕</span> 添加<input
                    type="file"
                    id="polishReferenceUpload"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    @change="
                      templates.addPolishReferences(
                        inputFiles($event),
                        'polish',
                      )
                    " /></label
                ><button
                  class="reference-clear"
                  id="clearPolishReferences"
                  type="button"
                  :disabled="!templates.polish.references.length"
                  @click="templates.clearReferences('polish')"
                >
                  清空
                </button>
              </div>
            </div>
            <ReferenceImages
              id="polishReferencePreview"
              :images="templates.polish.references"
              label="润色参考图"
              @mention="mention('polish', $event)"
              @remove="templates.removeReference('polish', $event)"
              @replace="
                (index, file) =>
                  templates.replaceReference('polish', index, file)
              "
              @move="(from, to) => templates.moveReference('polish', from, to)"
            />
          </div>
        </div>
        <div class="field-label">
          <label for="polishInstruction">润色要求</label>
          <PromptEditor
            ref="instructionEditor"
            id="polishInstruction"
            v-model="templates.polish.instruction"
            :images="mentionImages"
            :labels="mentionLabels"
            strict-mentions
            @focus="activeEditor = 'instruction'"
            @paste="paste($event, 'polish')"
            @drop="templates.addPolishReferences($event, 'polish')"
          />
        </div>
        <div class="polish-result-wrap">
          <div class="polish-result-heading">
            <span>润色结果</span
            ><span class="field-help" id="polishStatus">{{
              templates.polish.status
            }}</span>
          </div>
          <textarea
            v-model="templates.polish.result"
            id="polishResult"
            rows="6"
            placeholder="点击“生成建议”查看结果"
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button
          class="secondary-button"
          id="cancelPromptPolish"
          type="button"
          @click="templates.closePolish()"
        >
          取消
        </button>
        <div>
          <button
            :disabled="templates.polish.busy"
            class="secondary-button"
            id="generatePolishResult"
            type="button"
            @click="templates.generatePolish()"
          >
            生成建议</button
          ><button
            :disabled="!templates.polish.result || templates.polish.busy"
            class="primary-button"
            id="applyPolishResult"
            type="button"
            @click="templates.applyPolish()"
          >
            使用结果
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

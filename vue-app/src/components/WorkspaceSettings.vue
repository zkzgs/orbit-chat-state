<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '../composables/useEventListener'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceData } from '../composables/useWorkspaceData'
import { inputFiles } from '../utils/events'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import CustomSelect from './CustomSelect.vue'
import ModelInput from './ModelInput.vue'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const settings = useSettingsStore()
const data = useWorkspaceData()
const importInput = ref<HTMLInputElement | null>(null)
const settingsTabs = [
  { id: 'chat', label: '对话接口' },
  { id: 'image', label: '生图接口' },
  { id: 'proxy', label: '本地请求代理' },
  { id: 'images', label: '图片请求' },
  { id: 'prompts', label: '提示词偏好' },
  { id: 'habits', label: '习惯配置' },
  { id: 'display', label: '显示偏好' },
  { id: 'data', label: '数据管理' },
] as const
const activeTab = ref<string>('chat')
const settingsPane = ref<HTMLElement | null>(null)
const narrow = ref(window.innerWidth <= 780)
useEventListener(window, 'resize', () => {
  narrow.value = window.innerWidth <= 780
})
function selectTab(id: string) {
  activeTab.value = id
  if (settingsPane.value) settingsPane.value.scrollTop = 0
}
function onTabKey(event: KeyboardEvent) {
  const keys = narrow.value
    ? ['ArrowLeft', 'ArrowRight']
    : ['ArrowUp', 'ArrowDown']
  if (![...keys, 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = settingsTabs.findIndex((tab) => tab.id === activeTab.value)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? settingsTabs.length - 1
        : (index + (event.key === keys[0] ? -1 : 1) + settingsTabs.length) %
          settingsTabs.length
  selectTab(settingsTabs[next].id)
  const button = document.getElementById(`settings-tab-${activeTab.value}`)
  button?.focus()
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
</script>

<template>
  <div :hidden="!ui.settingsOpen" class="modal-backdrop" id="settingsBackdrop">
    <section
      class="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settingsTitle"
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Workspace setup</div>
          <h2 id="settingsTitle">接口与偏好设置</h2>
        </div>
        <button
          class="icon-button"
          id="closeSettings"
          title="关闭设置"
          aria-label="关闭设置"
          @click="settings.close()"
        >
          ×
        </button>
      </div>
      <div class="settings-layout">
        <nav
          class="settings-tabs"
          role="tablist"
          aria-label="设置模块"
          :aria-orientation="narrow ? 'horizontal' : 'vertical'"
          @keydown="onTabKey"
        >
          <button
            v-for="(tab, index) in settingsTabs"
            :key="tab.id"
            :id="`settings-tab-${tab.id}`"
            type="button"
            role="tab"
            :data-settings-tab="tab.id"
            :aria-controls="`settings-panel-${tab.id}`"
            :aria-selected="activeTab === tab.id"
            :tabindex="activeTab === tab.id ? 0 : -1"
            :class="{ active: activeTab === tab.id }"
            @click="selectTab(tab.id)"
          >
            <span aria-hidden="true">{{
              String(index + 1).padStart(2, '0')
            }}</span
            >{{ tab.label }}
          </button>
        </nav>
        <div class="settings-scroll" ref="settingsPane">
          <div
            class="settings-section"
            v-show="activeTab === 'chat'"
            id="settings-panel-chat"
            role="tabpanel"
            aria-labelledby="settings-tab-chat"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">01</span>
              <div>
                <strong>对话接口</strong
                ><small>兼容 OpenAI Chat Completions 格式</small>
              </div>
            </div>
            <div class="profile-manager">
              <label class="profile-select-label"
                >对话接口模板<CustomSelect
                  :model-value="workspace.state.activeConnectionProfiles.chat"
                  id="chatProfileSelect"
                  aria-label="选择对话接口模板"
                  :options="[
                    { value: '', label: '临时配置（未保存）' },
                    ...workspace.state.connectionProfiles.chat.map(
                      (profile) => ({
                        value: profile.id,
                        label: profile.name,
                      }),
                    ),
                  ]"
                  @change="settings.selectProfile('chat', $event)"
              /></label>
              <div class="profile-actions">
                <button
                  class="secondary-button"
                  id="saveChatProfile"
                  type="button"
                  @click="settings.saveProfile('chat')"
                >
                  另存为</button
                ><button
                  :disabled="!workspace.state.activeConnectionProfiles.chat"
                  class="secondary-button"
                  id="updateChatProfile"
                  type="button"
                  @click="settings.updateProfile('chat')"
                >
                  更新</button
                ><button
                  :disabled="!workspace.state.activeConnectionProfiles.chat"
                  class="secondary-button profile-delete"
                  id="deleteChatProfile"
                  type="button"
                  title="删除当前对话模板"
                  aria-label="删除当前对话模板"
                  @click="settings.deleteProfile('chat')"
                >
                  ×
                </button>
              </div>
              <small class="profile-help"
                >选择后立即切换。模板包含接口地址、Key、模型和已获取的模型列表。</small
              >
            </div>
            <label class="field-label"
              >接口地址<input
                v-model="settings.draft.chatBaseUrl"
                id="chatBaseUrl"
                type="url"
                placeholder="https://api.openai.com/v1/chat/completions"
            /></label>
            <div class="field-grid">
              <label class="field-label"
                >API Key
                <div class="input-with-action">
                  <input
                    :type="settings.showKey.chat ? 'text' : 'password'"
                    v-model="settings.draft.chatApiKey"
                    id="chatApiKey"
                    placeholder="sk-..."
                  /><button
                    class="show-key"
                    data-target="chatApiKey"
                    @click="settings.showKey.chat = !settings.showKey.chat"
                    type="button"
                  >
                    {{ settings.showKey.chat ? '隐藏' : '显示' }}
                  </button>
                </div></label
              ><label class="field-label"
                ><span class="field-label-heading"
                  >模型
                  <button
                    class="field-action"
                    id="loadChatModels"
                    type="button"
                    :disabled="settings.loadingModels.chat"
                    @click="settings.loadModels('chat')"
                  >
                    {{ settings.loadingModels.chat ? '获取中...' : '获取模型' }}
                  </button></span
                ><ModelInput
                  v-model="settings.draft.chatModel"
                  id="chatModel"
                  placeholder="gpt-4o-mini"
                  label="对话模型"
                  :models="workspace.modelCatalog.chat"
              /></label>
            </div>
            <label class="field-label"
              >思考程度
              <CustomSelect
                v-model="settings.draft.reasoningEffort"
                id="reasoningEffort"
                :options="[
                  { value: 'auto', label: '自动, 由模型决定' },
                  { value: 'none', label: '关闭 · none' },
                  { value: 'minimal', label: '最小 · minimal' },
                  { value: 'low', label: '轻度 · low' },
                  { value: 'medium', label: '中 · medium' },
                  { value: 'high', label: '高 · high' },
                  { value: 'xhigh', label: '极高 · xhigh' },
                  { value: 'max', label: 'Ultra · max' },
                ]"
              />
              <small class="field-help"
                >官方取值按模型而异,
                不支持的取值会被接口拒绝。自动模式不发送此字段</small
              ></label
            >
          </div>
          <div
            class="settings-section"
            v-show="activeTab === 'image'"
            id="settings-panel-image"
            role="tabpanel"
            aria-labelledby="settings-tab-image"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">02</span>
              <div>
                <strong>生图接口</strong
                ><small>可以使用和对话不同的服务商或密钥</small>
              </div>
            </div>
            <div class="profile-manager">
              <label class="profile-select-label"
                >生图接口模板<CustomSelect
                  :model-value="workspace.state.activeConnectionProfiles.image"
                  id="imageProfileSelect"
                  aria-label="选择生图接口模板"
                  :options="[
                    { value: '', label: '临时配置（未保存）' },
                    ...workspace.state.connectionProfiles.image.map(
                      (profile) => ({
                        value: profile.id,
                        label: profile.name,
                      }),
                    ),
                  ]"
                  @change="settings.selectProfile('image', $event)"
              /></label>
              <div class="profile-actions">
                <button
                  class="secondary-button"
                  id="saveImageProfile"
                  type="button"
                  @click="settings.saveProfile('image')"
                >
                  另存为</button
                ><button
                  :disabled="!workspace.state.activeConnectionProfiles.image"
                  class="secondary-button"
                  id="updateImageProfile"
                  type="button"
                  @click="settings.updateProfile('image')"
                >
                  更新</button
                ><button
                  :disabled="!workspace.state.activeConnectionProfiles.image"
                  class="secondary-button profile-delete"
                  id="deleteImageProfile"
                  type="button"
                  title="删除当前生图模板"
                  aria-label="删除当前生图模板"
                  @click="settings.deleteProfile('image')"
                >
                  ×
                </button>
              </div>
              <small class="profile-help"
                >选择后立即切换。模板包含接口地址、Key、模型和已获取的模型列表。</small
              >
            </div>
            <label class="field-label"
              >接口地址<input
                v-model="settings.draft.imageBaseUrl"
                id="imageBaseUrl"
                type="url"
                placeholder="https://api.openai.com/v1/images/generations"
            /></label>
            <div class="field-grid">
              <label class="field-label"
                >API Key
                <div class="input-with-action">
                  <input
                    :type="settings.showKey.image ? 'text' : 'password'"
                    v-model="settings.draft.imageApiKey"
                    id="imageApiKey"
                    placeholder="sk-..."
                  /><button
                    class="show-key"
                    data-target="imageApiKey"
                    @click="settings.showKey.image = !settings.showKey.image"
                    type="button"
                  >
                    {{ settings.showKey.image ? '隐藏' : '显示' }}
                  </button>
                </div></label
              ><label class="field-label"
                ><span class="field-label-heading"
                  >模型
                  <button
                    class="field-action"
                    id="loadImageModels"
                    type="button"
                    :disabled="settings.loadingModels.image"
                    @click="settings.loadModels('image')"
                  >
                    {{ settings.loadingModels.image ? '获取中...' : '获取模型' }}
                  </button></span
                ><ModelInput
                  v-model="settings.draft.imageModel"
                  id="imageModel"
                  placeholder="gpt-image-1"
                  label="生图模型"
                  :models="workspace.modelCatalog.image"
              /></label>
            </div>
            <div class="field-grid">
              <label class="field-label"
                >数量请求方式<CustomSelect
                  v-model="settings.draft.imageCountMode"
                  id="imageCountModeSetting"
                  :options="[
                    { value: 'parameter', label: '单次请求，使用 n 参数' },
                    { value: 'parallel', label: '并发请求，每次 n=1' },
                  ]"
                />
                <small class="field-help"
                  >官方标准是
                  n；并发是客户端策略，会把一批请求关联到同一条记录。</small
                ></label
              ><label class="field-label"
                >透明背景实现<CustomSelect
                  v-model="settings.draft.imageBackgroundMode"
                  id="imageBackgroundModeSetting"
                  :options="[
                    { value: 'parameter', label: '使用 background 参数' },
                    { value: 'prompt', label: '兼容模式，仅提示透明' },
                  ]"
                />
                <small class="field-help"
                  >优先使用 background
                  参数；兼容模式只为透明背景追加提示词，不会把“不透明”写进关键词。</small
                ></label
              >
            </div>
          </div>
          <div
            class="settings-section"
            v-show="activeTab === 'proxy'"
            id="settings-panel-proxy"
            role="tabpanel"
            aria-labelledby="settings-tab-proxy"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">03</span>
              <div>
                <strong>本地请求代理</strong
                ><small>用于访问不支持浏览器跨域的接口</small>
              </div>
            </div>
            <div class="field-label">
              <label for="proxyUrl">代理地址</label>
              <div class="proxy-address-row">
                <input
                  v-model="settings.draft.proxyUrl"
                  id="proxyUrl"
                  type="url"
                  placeholder="http://127.0.0.1:8787"
                  @input="settings.invalidateProxy()"
                /><button
                  class="secondary-button"
                  id="testProxyConnection"
                  type="button"
                  @click="settings.testProxy()"
                >
                  测试连接
                </button>
              </div>
              <small class="proxy-test-status" id="proxyTestStatus">{{
                settings.proxyStatus
              }}</small>
            </div>
            <label
              class="toggle-row"
              :class="{ 'is-disabled': !settings.canEnableProxy }"
              id="proxyToggleRow"
              ><span
                ><strong>使用本地代理</strong
                ><small
                  >测试成功后才可开启, 开启后对话, 模型,
                  润色和生图接口统一转发</small
                ></span
              ><input
                :disabled="!settings.canEnableProxy"
                v-model="settings.draft.proxyEnabled"
                type="checkbox"
                id="proxyEnabled" /><span class="toggle-ui"></span
            ></label>
            <p class="field-help">
              代理只处理请求转发和跨域响应, 不保存 Key 或请求内容, Key
              仍保存在当前浏览器
            </p>
          </div>
          <div
            class="settings-section"
            v-show="activeTab === 'images'"
            id="settings-panel-images"
            role="tabpanel"
            aria-labelledby="settings-tab-images"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">04</span>
              <div>
                <strong>图片请求</strong
                ><small>统一处理发送到接口的图片副本</small>
              </div>
            </div>
            <label class="toggle-row"
              ><span
                ><strong>压缩接口图片</strong
                ><small
                  >图片超过目标体积时压缩为 WebP, 本地缓存和历史记录仍保留原图,
                  GIF 为保留动画不会压缩</small
                ></span
              ><input
                v-model="settings.draft.compressRequestImages"
                type="checkbox"
                id="compressRequestImages" /><span class="toggle-ui"></span
            ></label>
            <label class="field-label"
              >单张图片目标体积 (MB)<input
                v-model.number="settings.draft.requestImageCompressionLimitMb"
                id="requestImageCompressionLimit"
                type="number"
                min="0.1"
                step="0.1"
                inputmode="decimal"
              /><small class="field-help"
                >默认 1MB, 只调整编码质量, 不改变像素宽高和比例,
                无法达到目标时会保留原尺寸并使用更小的提交副本</small
              ></label
            >
          </div>
          <div
            class="settings-section compact-section"
            v-show="activeTab === 'prompts'"
            id="settings-panel-prompts"
            role="tabpanel"
            aria-labelledby="settings-tab-prompts"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">05</span>
              <div>
                <strong>提示词偏好</strong
                ><small>系统提示词会随对应请求发送</small>
              </div>
            </div>
            <label class="field-label"
              >系统提示词<textarea
                v-model="settings.draft.systemPrompt"
                id="systemPrompt"
                rows="3"
                placeholder="例如: 你是一位简洁, 直接的中文助手"
              ></textarea
              ><small class="field-help"
                >作为对话请求中的 system 消息发送, 不会拼接到生图关键词</small
              ></label
            >
            <label class="field-label"
              >润色系统提示词<textarea
                v-model="settings.draft.imagePolishSystemPrompt"
                id="imagePolishSystemPrompt"
                rows="4"
                placeholder="定义润色模型的角色和输出规则"
              ></textarea
              ><small class="field-help"
                >作为润色请求中的 system 消息发送,
                用于定义润色模型的角色和输出规则</small
              ></label
            >
          </div>
          <div
            class="settings-section compact-section"
            v-show="activeTab === 'habits'"
            id="settings-panel-habits"
            role="tabpanel"
            aria-labelledby="settings-tab-habits"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">06</span>
              <div>
                <strong>习惯配置</strong
                ><small>仅影响生图任务，不改变对话消息的重试方式</small>
              </div>
            </div>
            <label class="toggle-row"
              ><span
                ><strong>重试请求后删除旧记录 (仅失败)</strong
                ><small
                  >新请求发出后删除失败旧记录, 不等待结果;
                  成功、部分成功或含收藏内容的记录保留。</small
                ></span
              ><input
                id="deleteRetriedRecordOnSuccess"
                type="checkbox"
                v-model="settings.draft.deleteRetriedRecordOnSuccess" /><span
                class="toggle-ui"
              ></span
            ></label>
            <label class="toggle-row"
              ><span
                ><strong>生图后清空对话框</strong
                ><small
                  >提交生图后清空提示词，保留参考图；重试不影响正在编辑的输入。</small
                ></span
              ><input
                id="clearInputAfterSubmit"
                type="checkbox"
                v-model="settings.draft.clearInputAfterSubmit" /><span
                class="toggle-ui"
              ></span
            ></label>
            <label class="toggle-row"
              ><span
                ><strong>成功请求也显示重试按钮</strong
                ><small>在已完成的生图记录上也提供重试操作。</small></span
              ><input
                id="alwaysShowRetryButton"
                type="checkbox"
                v-model="settings.draft.alwaysShowRetryButton" /><span
                class="toggle-ui"
              ></span
            ></label>
          </div>
          <div
            class="settings-section compact-section"
            v-show="activeTab === 'display'"
            id="settings-panel-display"
            role="tabpanel"
            aria-labelledby="settings-tab-display"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">07</span>
              <div><strong>显示偏好</strong></div>
            </div>
            <label class="toggle-row"
              ><span><strong>图片隐私遮罩</strong></span
              ><input
                v-model="settings.draft.imagePrivacyEnabled"
                type="checkbox"
                id="imagePrivacyEnabled" /><span class="toggle-ui"></span
            ></label>
            <label class="field-label"
              >遮罩范围<CustomSelect
                v-model="settings.draft.imagePrivacyMode"
                id="imagePrivacyMode"
                :options="[
                  { value: 'single', label: '单张图片' },
                  { value: 'list', label: '生图列表' },
                ]"
            /></label>
            <label class="toggle-row"
              ><span
                ><strong>演示模式</strong
                ><small>不填写 Key 时也能体验完整交互</small></span
              ><input
                v-model="settings.draft.demoMode"
                type="checkbox"
                id="demoMode" /><span class="toggle-ui"></span
            ></label>
          </div>
          <div
            class="settings-section compact-section data-management-section"
            v-show="activeTab === 'data'"
            id="settings-panel-data"
            role="tabpanel"
            aria-labelledby="settings-tab-data"
            tabindex="0"
          >
            <div class="section-title">
              <span class="section-number">08</span>
              <div>
                <strong>数据管理</strong
                ><small>操作时选择需要导出或清除的范围</small>
              </div>
            </div>
            <div class="data-management-actions">
              <button
                class="secondary-button"
                id="exportWorkspace"
                type="button"
                :disabled="ui.exporting"
                @click="data.open('export')"
              >
                {{ ui.exporting ? '导出中' : '导出' }}</button
              ><button
                class="secondary-button"
                id="importWorkspace"
                type="button"
                :disabled="data.importProgress.active"
                @click="importInput?.click()"
              >
                {{ data.importProgress.active ? '导入中' : '导入' }}</button
              ><button
                class="secondary-button danger"
                id="resetLocalData"
                type="button"
                @click="data.open('clear')"
              >
                清除数据</button
              ><input
                ref="importInput"
                type="file"
                id="workspaceImportFile"
                accept="application/json,.json"
                hidden
                @change="data.importFile(inputFiles($event)[0])"
              />
            </div>
            <div
              v-if="data.importProgress.active"
              class="import-progress"
              role="status"
              aria-live="polite"
              :class="{ indeterminate: data.importProgress.indeterminate }"
            >
              <div class="import-progress-label">
                <span>{{ data.importProgress.label }}</span>
                <span>{{ data.importProgress.percent }}%</span>
              </div>
              <div class="import-progress-track">
                <span
                  :style="{ width: `${data.importProgress.percent}%` }"
                ></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <span></span>
        <div>
          <button
            class="secondary-button"
            id="cancelSettings"
            @click="settings.close()"
          >
            取消</button
          ><button
            class="primary-button"
            id="saveSettings"
            @click="settings.save()"
          >
            保存设置
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

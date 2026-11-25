import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import { apiFetch, buildModelsEndpoint, normalizeProxyUrl } from '../api/client'
import { joinProxyPath } from '../utils/proxy-url'
import type { ApiKind, ConnectionProfile } from '../types/models'
import { cloneData } from '../utils/clone'
import { createId } from '../utils/id'
import { errorMessage } from '../utils/format'
import { rememberProxyUrl } from '../storage/proxy-url-history'
import { listGeminiModels } from '../api/native-media.js'
import { applyTheme } from '../utils/theme'

export const useSettingsStore = defineStore('settings-form', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const draft = reactive(cloneData(workspace.state.settings))
  let baseline = ''
  const modelRevision = { chat: 0, image: 0 }
  const modelRequest = { chat: -1, image: -1 }
  const showKey = reactive({ chat: false, image: false })
  const loadingModels = reactive({ chat: false, image: false })
  const modelStatus = reactive({ chat: '', image: '' })
  const verifiedProxy = ref('')
  const proxyStatus = ref('尚未测试代理服务')
  const proxyTesting = ref(false)
  const canEnableProxy = computed(
    () =>
      normalizeProxyUrl(draft.proxyUrl) === verifiedProxy.value &&
      Boolean(verifiedProxy.value),
  )
  function syncFromWorkspace() {
    modelRevision.chat++
    modelRevision.image++
    Object.assign(draft, cloneData(workspace.state.settings))
    modelStatus.chat = modelStatus.image = ''
    if (ui.settingsOpen) baseline = snapshot()
  }
  function open() {
    syncFromWorkspace()
    baseline = snapshot()
    if (draft.proxyEnabled)
      verifiedProxy.value = normalizeProxyUrl(draft.proxyUrl)
    ui.settingsOpen = true
    applyTheme(draft.theme)
  }
  function snapshot() {
    return JSON.stringify({
      draft,
      settings: workspace.state.settings,
      profiles: workspace.state.connectionProfiles,
      activeProfiles: workspace.state.activeConnectionProfiles,
      models: workspace.modelCatalog,
    })
  }
  function close(force = false) {
    modelRevision.chat++
    modelRevision.image++
    const withoutCatalog = (value: string) => {
      const data = JSON.parse(value)
      delete data.models
      return JSON.stringify(data)
    }
    if (!force && baseline && withoutCatalog(snapshot()) !== withoutCatalog(baseline)) {
      if (window.confirm('设置已修改, 是否保存更改?')) {
        save()
        return
      }
      const saved = JSON.parse(baseline)
      Object.assign(workspace.state.settings, saved.settings)
      Object.assign(workspace.state.connectionProfiles, saved.profiles)
      Object.assign(
        workspace.state.activeConnectionProfiles,
        saved.activeProfiles,
      )
      Object.assign(workspace.modelCatalog, saved.models)
      Object.assign(draft, cloneData(saved.settings))
    }
    applyTheme(workspace.state.settings.theme)
    ui.settingsOpen = false
  }
  watch(
    () => draft.theme,
    (theme) => {
      if (ui.settingsOpen) applyTheme(theme)
    },
  )
  function save() {
    if (
      !Number.isInteger(draft.imageAgentRetryLimit) ||
      draft.imageAgentRetryLimit < 0 ||
      draft.imageAgentRetryLimit > 5
    ) {
      ui.notify('Agent 重试上限应为 0 到 5 的整数', 'error')
      return
    }
    for (const kind of ['chat', 'image'] as const)
      draft[`${kind}FetchedModels`] = [...workspace.modelCatalog[kind]]
    Object.assign(workspace.state.settings, cloneData(draft))
    rememberProxyUrl(draft.proxyUrl)
    close(true)
    ui.notify('设置已保存')
  }
  function clearConnectionModels(kind: ApiKind) {
    modelRevision[kind]++
    modelStatus[kind] = ''
    draft[kind === 'chat' ? 'chatModel' : 'imageModel'] = ''
    draft[kind === 'chat' ? 'chatCustomModels' : 'imageCustomModels'] = ''
    workspace.modelCatalog[kind] = []
  }
  function providerEdited(value: typeof draft.imageProvider) {
    if (value === draft.imageProvider) return
    draft.imageProvider = value
    clearConnectionModels('image')
  }
  function connectionEdited(
    kind: ApiKind,
    field: 'BaseUrl' | 'ApiKey',
    value: string,
  ) {
    const key = `${kind}${field}` as
      'chatBaseUrl' | 'chatApiKey' | 'imageBaseUrl' | 'imageApiKey'
    if (draft[key].trim() === value.trim()) {
      draft[key] = value
      return
    }
    draft[key] = value
    clearConnectionModels(kind)
    // Keep the selected template as the explicit update target.
  }
  function invalidateProxy() {
    verifiedProxy.value = ''
    draft.proxyEnabled = false
    proxyStatus.value = '代理地址已变化, 请重新测试'
  }
  async function testProxy() {
    proxyTesting.value = true
    proxyStatus.value = '正在连接'
    try {
      const response = await fetch(joinProxyPath(draft.proxyUrl, 'health'), {
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`代理返回 ${response.status}`)
      const payload = (await response.json()) as {
        ok: boolean
        service: string
      }
      if (!payload.ok || payload.service !== 'orbit-api-proxy')
        throw new Error('该地址不是 Orbit 代理服务')
      verifiedProxy.value = normalizeProxyUrl(draft.proxyUrl)
      rememberProxyUrl(draft.proxyUrl)
      proxyStatus.value = '代理连接成功'
    } catch (error) {
      verifiedProxy.value = ''
      draft.proxyEnabled = false
      const timedOut =
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      proxyStatus.value = timedOut ? '连接代理超时' : errorMessage(error)
      ui.notify(proxyStatus.value, 'error')
    } finally {
      proxyTesting.value = false
    }
  }
  function ensureModels(kind: ApiKind) {
    if (workspace.modelCatalog[kind].length || modelStatus[kind]) return
    void loadModels(kind, true)
  }
  async function loadModels(kind: ApiKind, automatic = false) {
    const revision = modelRevision[kind]
    if (!ui.settingsOpen || modelRequest[kind] === revision) return
    const settings = draft
    const baseUrl = settings[`${kind}BaseUrl`].trim()
    const key = settings[`${kind}ApiKey`].trim()
    if (!baseUrl || !key) {
      if (automatic) return
      modelStatus[kind] = '请先填写对应的接口地址和 API Key'
      ui.notify(modelStatus[kind], 'error')
      return
    }
    if (automatic) {
      try {
        const url = new URL(baseUrl)
        if (!['https:', 'http:'].includes(url.protocol)) return
        const saved = workspace.state.settings
        if (key === saved[`${kind}ApiKey`].trim() && saved[`${kind}BaseUrl`] &&
            url.origin !== new URL(saved[`${kind}BaseUrl`]).origin) {
          modelStatus[kind] = '接口域名已变更，请确认后手动获取模型'
          return
        }
      } catch { return }
    }
    modelRequest[kind] = revision
    loadingModels[kind] = true
    modelStatus[kind] = ''
    try {
      if (kind === 'image' && settings.imageProvider === 'gemini') {
        const models = await listGeminiModels(
          apiFetch,
          settings,
          AbortSignal.timeout(15000),
        )
        if (revision !== modelRevision[kind]) return
        workspace.modelCatalog.image = models
        if (!models.length) modelStatus.image = '接口未返回可用模型'
        const profile = workspace.state.connectionProfiles.image.find(
          (item) => item.id === workspace.state.activeConnectionProfiles.image,
        )
        if (
          !automatic && profile &&
          profile.baseUrl.trim() === baseUrl.trim() &&
          profile.apiKey.trim() === key.trim() && profile.imageProvider === settings.imageProvider
        )
          profile.models = [...workspace.modelCatalog.image]
        if (!automatic) ui.notify(`已获取 ${workspace.modelCatalog.image.length} 个模型`)
        return
      }
      const response = await apiFetch(
        buildModelsEndpoint(baseUrl),
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15000),
        },
        settings,
      )
      const payload = (await response.json()) as {
        data?: { id: string }[]
        error?: { message?: string }
      }
      if (!response.ok)
        throw new Error(payload.error?.message || `接口返回 ${response.status}`)
      if (revision !== modelRevision[kind]) return
      workspace.modelCatalog[kind] = [...new Set(Array.isArray(payload.data)
        ? payload.data.map((item) => item?.id).filter((id) => typeof id === 'string' && id.trim())
        : [])].sort()
      if (!workspace.modelCatalog[kind].length) modelStatus[kind] = '接口未返回可用模型'
      const active = workspace.state.connectionProfiles[kind].find(
        (item) => item.id === workspace.state.activeConnectionProfiles[kind],
      )
      if (
        !automatic && active &&
        active.baseUrl.trim() === baseUrl.trim() &&
        active.apiKey.trim() === key.trim() &&
        (kind === 'chat' || (active.imageProvider || 'openai') === settings.imageProvider)
      )
        active.models = [...workspace.modelCatalog[kind]]
      if (!automatic) ui.notify(`已获取 ${workspace.modelCatalog[kind].length} 个模型`)
    } catch (error) {
      if (revision === modelRevision[kind]) {
        modelStatus[kind] = '获取模型失败'
        if (!automatic) ui.notify(errorMessage(error), 'error')
      }
    } finally {
      if (modelRequest[kind] === revision) {
        modelRequest[kind] = -1
        loadingModels[kind] = false
      }
    }
  }
  function fields(kind: ApiKind) {
    return kind === 'chat'
      ? {
          baseUrl: draft.chatBaseUrl.trim(),
          apiKey: draft.chatApiKey.trim(),
          model: draft.chatModel.trim(),
          customModels: draft.chatCustomModels?.trim() || '',
          reasoningEffort: draft.reasoningEffort,
          apiFormat: draft.chatApiFormat,
        }
      : {
          baseUrl: draft.imageBaseUrl.trim(),
          apiKey: draft.imageApiKey.trim(),
          model: draft.imageModel.trim(),
          customModels: draft.imageCustomModels?.trim() || '',
          imageProvider: draft.imageProvider,
          countMode: draft.imageCountMode,
          backgroundMode: draft.imageBackgroundMode,
        }
  }
  function selectProfile(kind: ApiKind, id: string) {
    modelRevision[kind]++
    modelStatus[kind] = ''
    workspace.state.activeConnectionProfiles[kind] = id
    const profile = workspace.state.connectionProfiles[kind].find(
      (item) => item.id === id,
    )
    if (!profile) {
      workspace.modelCatalog[kind] = []
      workspace.state.settings[`${kind}FetchedModels`] = []
      ui.notify('已切换到临时配置，当前填写内容保留')
      return
    }
    if (kind === 'chat') {
      Object.assign(draft, {
        chatBaseUrl: profile.baseUrl,
        chatApiKey: profile.apiKey,
        chatModel: profile.model,
        chatCustomModels: profile.customModels || '',
        reasoningEffort: profile.reasoningEffort || 'auto',
        chatApiFormat: profile.apiFormat || 'chat',
      })
      Object.assign(workspace.state.settings, {
        chatBaseUrl: draft.chatBaseUrl,
        chatApiKey: draft.chatApiKey,
        chatModel: draft.chatModel,
        chatCustomModels: draft.chatCustomModels,
        reasoningEffort: draft.reasoningEffort,
        chatApiFormat: draft.chatApiFormat,
      })
    } else {
      Object.assign(draft, {
        imageBaseUrl: profile.baseUrl,
        imageApiKey: profile.apiKey,
        imageModel: profile.model,
        imageCustomModels: profile.customModels || '',
        imageProvider: profile.imageProvider || 'openai',
        imageCountMode: profile.countMode || 'parameter',
        imageBackgroundMode: profile.backgroundMode || 'parameter',
      })
      Object.assign(workspace.state.settings, {
        imageBaseUrl: draft.imageBaseUrl,
        imageApiKey: draft.imageApiKey,
        imageModel: draft.imageModel,
        imageCustomModels: draft.imageCustomModels,
        imageProvider: draft.imageProvider,
        imageCountMode: draft.imageCountMode,
        imageBackgroundMode: draft.imageBackgroundMode,
      })
    }
    workspace.modelCatalog[kind] = [...(profile.models || [])]
    workspace.state.settings[`${kind}FetchedModels`] = [...workspace.modelCatalog[kind]]
    ui.notify(`已切换到“${profile.name}”`)
  }
  function suggestedProfileName(kind: ApiKind) {
    try {
      return (
        new URL(fields(kind).baseUrl).hostname.replace(/^api\./, '') ||
        (kind === 'chat' ? '对话接口' : '生图接口')
      )
    } catch {
      return kind === 'chat' ? '对话接口' : '生图接口'
    }
  }
  function saveProfile(kind: ApiKind) {
    const profileFields = fields(kind)
    if (!profileFields.baseUrl) {
      ui.notify('请先填写接口地址', 'error')
      return
    }
    const name = window.prompt('请输入模板名称', suggestedProfileName(kind))
    if (name === null) return
    const cleanName = name.trim()
    if (!cleanName) {
      ui.notify('模板名称不能为空', 'error')
      return
    }
    const profiles = workspace.state.connectionProfiles[kind]
    const existing = profiles.find(
      (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
    )
    if (existing && !window.confirm(`模板“${existing.name}”已存在，覆盖它吗?`))
      return
    const now = Date.now()
    const profile: ConnectionProfile = {
      id: existing?.id || createId(),
      name: cleanName,
      ...profileFields,
      models: workspace.modelCatalog[kind].length
        ? [...workspace.modelCatalog[kind]]
        : existing?.baseUrl === profileFields.baseUrl &&
            existing?.apiKey === profileFields.apiKey
          ? [...(existing.models || [])]
          : [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    if (existing) profiles[profiles.indexOf(existing)] = profile
    else profiles.push(profile)
    workspace.state.activeConnectionProfiles[kind] = profile.id
    selectProfile(kind, profile.id)
    ui.notify(existing ? '模板已覆盖' : '模板已保存')
  }
  function updateProfile(kind: ApiKind) {
    const profile = workspace.state.connectionProfiles[kind].find(
      (item) => item.id === workspace.state.activeConnectionProfiles[kind],
    )
    if (!profile) {
      ui.notify('请先选择需要更新的模板', 'error')
      return
    }
    Object.assign(profile, fields(kind), {
      models: [...workspace.modelCatalog[kind]],
      updatedAt: Date.now(),
    })
    selectProfile(kind, profile.id)
    ui.notify(`“${profile.name}”已更新`)
  }
  function deleteProfile(kind: ApiKind) {
    const id = workspace.state.activeConnectionProfiles[kind]
    const profile = workspace.state.connectionProfiles[kind].find(
      (item) => item.id === id,
    )
    if (!profile || !confirm(`删除接口模板“${profile.name}”?`)) return
    workspace.state.connectionProfiles[kind] =
      workspace.state.connectionProfiles[kind].filter((item) => item.id !== id)
    workspace.state.activeConnectionProfiles[kind] = ''
    ui.notify('模板已删除，当前接口配置仍保留')
  }
  return {
    draft,
    showKey,
    loadingModels,
    modelStatus,
    verifiedProxy,
    proxyStatus,
    proxyTesting,
    canEnableProxy,
    open,
    syncFromWorkspace,
    close,
    save,
    invalidateProxy,
    connectionEdited,
    providerEdited,
    testProxy,
    ensureModels,
    loadModels,
    selectProfile,
    saveProfile,
    updateProfile,
    deleteProfile,
  }
})

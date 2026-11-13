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
  const showKey = reactive({ chat: false, image: false })
  const loadingModels = reactive({ chat: false, image: false })
  const verifiedProxy = ref('')
  const proxyStatus = ref('尚未测试代理服务')
  const proxyTesting = ref(false)
  const canEnableProxy = computed(
    () =>
      normalizeProxyUrl(draft.proxyUrl) === verifiedProxy.value &&
      Boolean(verifiedProxy.value),
  )
  function open() {
    Object.assign(draft, cloneData(workspace.state.settings))
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
    if (!force && baseline && snapshot() !== baseline) {
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
    Object.assign(workspace.state.settings, cloneData(draft))
    rememberProxyUrl(draft.proxyUrl)
    close(true)
    ui.notify('设置已保存')
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
  async function loadModels(kind: ApiKind, fromDraft = ui.settingsOpen) {
    if (loadingModels[kind]) return
    const settings = fromDraft ? draft : workspace.state.settings
    const baseUrl =
      kind === 'chat' ? settings.chatBaseUrl : settings.imageBaseUrl
    const key = kind === 'chat' ? settings.chatApiKey : settings.imageApiKey
    if (!baseUrl || !key) {
      ui.notify('请先填写对应的接口地址和 API Key', 'error')
      return
    }
    loadingModels[kind] = true
    try {
      if (kind === 'image' && settings.imageProvider === 'gemini') {
        workspace.modelCatalog.image = await listGeminiModels(
          apiFetch,
          settings,
          AbortSignal.timeout(15000),
        )
        const profile = workspace.state.connectionProfiles.image.find(
          (item) => item.id === workspace.state.activeConnectionProfiles.image,
        )
        if (profile) profile.models = [...workspace.modelCatalog.image]
        ui.notify(`已获取 ${workspace.modelCatalog.image.length} 个模型`)
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
      workspace.modelCatalog[kind] = (payload.data || []).map((item) => item.id)
      const active = workspace.state.connectionProfiles[kind].find(
        (item) => item.id === workspace.state.activeConnectionProfiles[kind],
      )
      if (active) active.models = [...workspace.modelCatalog[kind]]
      ui.notify(`已获取 ${workspace.modelCatalog[kind].length} 个模型`)
    } catch (error) {
      ui.notify(errorMessage(error), 'error')
    } finally {
      loadingModels[kind] = false
    }
  }
  function fields(kind: ApiKind) {
    return kind === 'chat'
      ? {
          baseUrl: draft.chatBaseUrl.trim(),
          apiKey: draft.chatApiKey.trim(),
          model: draft.chatModel.trim(),
          reasoningEffort: draft.reasoningEffort,
        }
      : {
          baseUrl: draft.imageBaseUrl.trim(),
          apiKey: draft.imageApiKey.trim(),
          model: draft.imageModel.trim(),
          imageProvider: draft.imageProvider,
          countMode: draft.imageCountMode,
          backgroundMode: draft.imageBackgroundMode,
        }
  }
  function selectProfile(kind: ApiKind, id: string) {
    workspace.state.activeConnectionProfiles[kind] = id
    const profile = workspace.state.connectionProfiles[kind].find(
      (item) => item.id === id,
    )
    if (!profile) {
      workspace.modelCatalog[kind] = []
      ui.notify('已切换到临时配置，当前填写内容保留')
      return
    }
    if (kind === 'chat') {
      Object.assign(draft, {
        chatBaseUrl: profile.baseUrl,
        chatApiKey: profile.apiKey,
        chatModel: profile.model,
        reasoningEffort: profile.reasoningEffort || 'auto',
      })
      Object.assign(workspace.state.settings, {
        chatBaseUrl: draft.chatBaseUrl,
        chatApiKey: draft.chatApiKey,
        chatModel: draft.chatModel,
        reasoningEffort: draft.reasoningEffort,
      })
    } else {
      Object.assign(draft, {
        imageBaseUrl: profile.baseUrl,
        imageApiKey: profile.apiKey,
        imageModel: profile.model,
        imageProvider: profile.imageProvider || 'openai',
        imageCountMode: profile.countMode || 'parameter',
        imageBackgroundMode: profile.backgroundMode || 'parameter',
      })
      Object.assign(workspace.state.settings, {
        imageBaseUrl: draft.imageBaseUrl,
        imageApiKey: draft.imageApiKey,
        imageModel: draft.imageModel,
        imageProvider: draft.imageProvider,
        imageCountMode: draft.imageCountMode,
        imageBackgroundMode: draft.imageBackgroundMode,
      })
    }
    workspace.modelCatalog[kind] = [...(profile.models || [])]
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
        : [...(existing?.models || [])],
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
      models: workspace.modelCatalog[kind].length
        ? [...workspace.modelCatalog[kind]]
        : [...(profile.models || [])],
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
    verifiedProxy,
    proxyStatus,
    proxyTesting,
    canEnableProxy,
    open,
    close,
    save,
    invalidateProxy,
    testProxy,
    loadModels,
    selectProfile,
    saveProfile,
    updateProfile,
    deleteProfile,
  }
})

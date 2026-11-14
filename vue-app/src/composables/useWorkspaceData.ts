import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useImageGenerationStore } from '../stores/image-generation'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { usePromptTemplatesStore } from '../stores/prompt-templates'
import { useHistoryStore } from '../stores/history'
import { downloadFile } from '../utils/files'
import { workspaceArchive } from '../storage/archive'
import { outputImageIds } from '../storage/workspace-archive.js'
import { errorMessage, formatExportTimestamp } from '../utils/format'
import { createDefaultSettings } from '../constants/workspace'
import { createInitialState, normalizeFavoriteFolders } from '../storage/state'
import { clearProxyUrlHistory } from '../storage/proxy-url-history'
import {
  collectImageIds,
  combineNamedRecords,
  combineRecords,
  mergeFolders,
  mergeImages,
} from '../storage/transfer'
import type { DataScope, WorkspaceExport } from '../types/models'
import { remapAgentMessage } from '../api/image-agent.js'
import { chatDocuments } from '../api/chat-files.js'
import {
  clearChatDrafts,
  clearImagePromptDraft,
  clearInputDrafts,
} from '../storage/input-drafts.js'
import { imageStorage } from '../storage/database'

const scopeLabels: Record<DataScope, string> = {
  chat: '对话工作区',
  image: '生图工作区',
  workspace: '全部工作区',
  config: '配置',
  all: '全部数据',
}
const exportFilePrefixes: Record<DataScope, string> = {
  chat: 'orbit-chat-workspace',
  image: 'orbit-image-workspace',
  workspace: 'orbit-workspace',
  config: 'orbit-config',
  all: 'orbit-all-data',
}

export function useWorkspaceData() {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const image = useImageGenerationStore()
  const chat = useChatStore()
  const importProgress = ui.importProgress
  const exportProgress = ui.exportProgress
  function setImportProgress(
    label: string,
    percent: number,
    indeterminate = false,
  ) {
    Object.assign(importProgress, {
      active: true,
      label,
      percent,
      indeterminate,
    })
  }
  function open(action: 'export' | 'clear') {
    ui.dataScope.action = action
    ui.dataScope.open = true
  }
  async function exportScope(scope: DataScope) {
    if (ui.exporting) return
    if (scope === 'config' || scope === 'all') {
      const label = scope === 'all' ? '全部数据' : '配置'
      if (
        !window.confirm(
          `导出${label}会包含 API Key、接口地址和模板, 请确认文件保存位置安全`,
        )
      )
        return
    }
    const includeChat = ['chat', 'workspace', 'all'].includes(scope)
    const includeImages = ['image', 'workspace', 'all'].includes(scope)
    const includeConfig = scope === 'all' || scope === 'config'
    ui.exporting = true
    Object.assign(exportProgress, {
      active: true,
      label: '正在打包备份',
      percent: 0,
    })
    try {
      await new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      )
      await workspace.initialize()
      const conversations = includeChat ? workspace.state.conversations : []
      const imageHistory = includeImages ? workspace.batches : []
      const imageTasks = includeImages ? workspace.tasks : []
      const draftIds: string[] = []
      if (includeImages)
        for (const reference of image.references)
          draftIds.push(
            reference.imageId ||
              (await workspace.saveImage(reference.data, reference.name)),
          )
      const ids = collectImageIds(
        conversations,
        imageHistory,
        imageTasks,
        includeConfig ? workspace.state.settings : undefined,
      )
      draftIds.forEach((id) => ids.add(id))
      if (includeImages)
        workspace.images
          .filter((item) => item.favoriteFolderIds?.length)
          .forEach((item) => ids.add(item.id))
      const outputs = outputImageIds({
        images: workspace.images,
        conversations: workspace.state.conversations,
        imageHistory: workspace.batches,
      })
      const payload: WorkspaceExport = {
        version: 12,
        scope,
        exportedAt: Date.now(),
        contextMode: workspace.state.contextMode,
        activeConversationId: workspace.state.activeConversationId,
        conversations,
        images: workspace.images
          .filter((item) => ids.has(item.id))
          .map((item) => ({
            ...item,
            origin: outputs.has(item.id) ? 'generated' : 'upload',
          })),
        imageHistory,
        imageTasks,
      }
      if (includeImages) {
        payload.favoriteFolders = workspace.favoriteFolders
        payload.imageDraft = {
          prompt: image.prompt,
          config: image.draftConfig,
          referenceImageIds: draftIds,
        }
      }
      if (includeConfig)
        payload.apiConfig = {
          settings: workspace.state.settings,
          connectionProfiles: workspace.state.connectionProfiles,
          activeConnectionProfiles: workspace.state.activeConnectionProfiles,
          modelCatalog: workspace.modelCatalog,
        }
      downloadFile(
        await workspaceArchive.exportFile(payload, (progress: number) => {
          exportProgress.percent = Math.max(
            exportProgress.percent,
            Math.min(100, Math.round(progress * 100)),
          )
        }),
        'application/zip',
        `${exportFilePrefixes[scope]}-${formatExportTimestamp()}.zip`,
      )
      ui.notify(`${scopeLabels[scope]}已导出`)
    } catch (error) {
      ui.notify(`导出失败: ${errorMessage(error)}`, 'error')
    } finally {
      ui.exporting = false
      exportProgress.active = false
    }
  }
  async function importFile(file?: File) {
    if (!file) return
    if (importProgress.active) return
    setImportProgress('正在读取备份', 0)
    let dispose = async () => {}
    try {
      await workspace.initialize()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const archive = await workspaceArchive.importFile(
        file,
        (progress: number) =>
          setImportProgress('正在读取备份', Math.round(progress * 60)),
      )
      dispose = archive.dispose
      const incoming = archive.payload as unknown as WorkspaceExport
      setImportProgress('已读取备份, 等待确认', 60, true)
      const scope = ['chat', 'image', 'workspace', 'config', 'all'].includes(
        incoming.scope,
      )
        ? incoming.scope
        : 'workspace'
      const includeChat = ['chat', 'workspace', 'all'].includes(scope)
      const includeImages = ['image', 'workspace', 'all'].includes(scope)
      const includeConfig = scope === 'all' || scope === 'config'
      if (includeConfig && !incoming.apiConfig)
        throw new Error('文件中没有配置')
      if (
        !confirm(
          `导入工作区: ${incoming.conversations?.length || 0} 个对话, ${incoming.imageHistory?.length || 0} 条生图记录?`,
        )
      )
        return
      const input = prompt(
        '请选择导入方式:\n输入 "覆盖" 替换对应范围\n输入 "合并" 保留不同 ID 的项目, 同 ID 使用导入版本',
        '合并',
      )
      if (input === null) return
      const mode = input.trim().toLowerCase()
      if (!['覆盖', '合并', 'overwrite', 'merge'].includes(mode))
        throw new Error('导入方式只能填写 "覆盖" 或 "合并"')
      const merge = ['合并', 'merge'].includes(mode)
      if (includeChat)
        await chatDocuments.restore(incoming.conversations, imageStorage)
      setImportProgress('正在匹配图片内容', 65)
      // 覆盖只移除所选工作区独占的图片, 保留其他工作区和模板的引用
      const preserved = collectImageIds(
        includeChat ? [] : workspace.state.conversations,
        includeImages ? [] : workspace.batches,
        includeImages ? [] : workspace.tasks,
        scope === 'all' ? undefined : workspace.state.settings,
      )
      if (!includeImages) {
        workspace.imageDraftIds.forEach((id) => preserved.add(id))
        workspace.images
          .filter((item) => item.favoriteFolderIds?.length)
          .forEach((item) => preserved.add(item.id))
      }
      const sourceImages = incoming.images || []
      if (includeImages && incoming.favoriteFolders) {
        const folders = merge
          ? mergeFolders(workspace.favoriteFolders, incoming.favoriteFolders)
          : null
        workspace.favoriteFolders =
          folders?.folders || normalizeFavoriteFolders(incoming.favoriteFolders)
        if (folders) {
          sourceImages.forEach((item) => {
            item.favoriteFolderIds = folders.remap(item.favoriteFolderIds)
          })
          incoming.imageTasks?.forEach((item) => {
            item.favoriteFolderIds = folders.remap(item.favoriteFolderIds)
          })
        }
      }
      const combined = await mergeImages(
        merge || scope === 'config'
          ? workspace.images
          : workspace.images.filter((item) => preserved.has(item.id)),
        sourceImages,
        (progress) =>
          setImportProgress('正在匹配图片内容', 65 + Math.round(progress * 25)),
      )
      const remap = combined.remap
      if (includeImages && incoming.favoriteFolders) {
        for (const source of incoming.favoriteFolders) {
          if (!Object.hasOwn(source, 'coverImageId')) continue
          const target = workspace.favoriteFolders.find(
            (folder) =>
              folder.name.toLocaleLowerCase() ===
              source.name.toLocaleLowerCase(),
          )
          if (target)
            target.coverImageId =
              typeof source.coverImageId === 'string'
                ? remap([source.coverImageId])[0]
                : null
        }
      }
      incoming.conversations?.forEach((item) =>
        item.messages.forEach((message) => {
          message.imageIds = remap(message.imageIds)
          message.mentionImageIds = remap(message.mentionImageIds)
          remapAgentMessage(message, remap)
        }),
      )
      incoming.imageHistory?.forEach((item) => {
        item.imageIds = remap(item.imageIds)
        item.referenceImageIds = remap(item.referenceImageIds)
      })
      incoming.imageTasks?.forEach((item) => {
        item.referenceImageIds = remap(item.referenceImageIds)
        if (item.status === 'running') {
          item.status = 'error'
          item.detail = '导入的任务无法继续执行'
        }
      })
      if (includeImages && !merge) {
        workspace.generation++
        image.dispose()
      }
      if (includeChat) {
        chat.stopAll()
        if (!merge) chat.resetDraft()
      }
      workspace.images = combined.records
      if (includeChat) {
        workspace.state.conversations = combineRecords(
          merge ? workspace.state.conversations : [],
          incoming.conversations || [],
        )
        if (!workspace.state.conversations.length)
          workspace.state.conversations = createInitialState().conversations
        workspace.state.activeConversationId =
          workspace.state.conversations.some(
            (item) => item.id === incoming.activeConversationId,
          )
            ? incoming.activeConversationId!
            : workspace.state.conversations[0].id
        if (incoming.contextMode)
          workspace.state.contextMode = incoming.contextMode
      }
      if (includeImages) {
        workspace.batches = combineRecords(
          merge ? workspace.batches : [],
          incoming.imageHistory || [],
        ).sort((a, b) => b.createdAt - a.createdAt)
        workspace.tasks = combineRecords(
          merge ? workspace.tasks : [],
          incoming.imageTasks || [],
        ).sort((a, b) => b.startedAt - a.startedAt)
        if (incoming.imageDraft)
          image.applyConfig(
            incoming.imageDraft.config,
            incoming.imageDraft.prompt,
            remap(incoming.imageDraft.referenceImageIds),
          )
        else if (!merge) {
          image.prompt = ''
          image.references = []
          image.requestType = 'generation'
        }
        useHistoryStore().setLibrary('history')
      }
      if (includeConfig && incoming.apiConfig) {
        const config = incoming.apiConfig
        const settings = config.settings
        if (settings) {
          const old = workspace.state.settings
          const prompts = settings.imagePromptTemplates || []
          const polish = settings.imagePolishTemplates || []
          ;[...prompts, ...polish].forEach((item) => {
            item.referenceImageIds = remap(item.referenceImageIds)
          })
          const imagePromptTemplates = merge
            ? combineNamedRecords(old.imagePromptTemplates, prompts)
            : prompts
          const imagePolishTemplates = merge
            ? combineNamedRecords(old.imagePolishTemplates, polish)
            : polish
          Object.assign(old, {
            ...(!merge
              ? {
                  deleteRetriedRecordOnSuccess: false,
                  clearInputAfterSubmit: false,
                  alwaysShowRetryButton: false,
                }
              : {}),
            ...settings,
            imageOptions: { ...old.imageOptions, ...settings.imageOptions },
            imagePromptTemplates,
            imagePolishTemplates,
            activeImagePromptTemplateId: imagePromptTemplates.some(
              (item) => item.id === settings.activeImagePromptTemplateId,
            )
              ? settings.activeImagePromptTemplateId
              : merge &&
                  imagePromptTemplates.some(
                    (item) => item.id === old.activeImagePromptTemplateId,
                  )
                ? old.activeImagePromptTemplateId
                : '',
            activeImagePolishTemplateId: imagePolishTemplates.some(
              (item) => item.id === settings.activeImagePolishTemplateId,
            )
              ? settings.activeImagePolishTemplateId
              : merge &&
                  imagePolishTemplates.some(
                    (item) => item.id === old.activeImagePolishTemplateId,
                  )
                ? old.activeImagePolishTemplateId
                : '',
          })
        }
        for (const kind of ['chat', 'image'] as const) {
          const profiles = config.connectionProfiles?.[kind] || []
          workspace.state.connectionProfiles[kind] = merge
            ? combineNamedRecords(
                workspace.state.connectionProfiles[kind],
                profiles,
              )
            : profiles
          const active =
            config.activeConnectionProfiles?.[kind] ||
            (merge ? workspace.state.activeConnectionProfiles[kind] : '')
          workspace.state.activeConnectionProfiles[kind] =
            workspace.state.connectionProfiles[kind].some(
              (item) => item.id === active,
            )
              ? active
              : ''
          workspace.modelCatalog[kind] = [
            ...new Set([
              ...(merge ? workspace.modelCatalog[kind] : []),
              ...(config.modelCatalog?.[kind] || []),
            ]),
          ]
        }
      }
      await workspace.collectUnusedImages()
      setImportProgress('正在写入本地缓存', 93, true)
      if (!(await workspace.saveAllImages()))
        throw new Error('图片未能写入本地缓存, 请重试导入')
      if (ui.settingsOpen) useSettingsStore().open()
      if (ui.polishOpen) usePromptTemplatesStore().syncPolishFromSettings()
      setImportProgress('导入完成', 100)
      ui.notify(`工作区已${merge ? '合并导入' : '覆盖导入'}`)
    } catch (error) {
      ui.notify(errorMessage(error), 'error')
    } finally {
      if (importProgress.percent >= 100)
        await new Promise((resolve) => window.setTimeout(resolve, 600))
      await dispose()
      Object.assign(importProgress, {
        active: false,
        indeterminate: false,
        label: '',
        percent: 0,
      })
    }
  }
  async function clearScope(scope: DataScope) {
    const detail =
      scope === 'config'
        ? '会删除接口配置、模板和模型列表。'
        : scope === 'workspace'
          ? '会删除对话和生图记录, 保留接口配置。'
          : scope === 'chat'
            ? '会删除对话及其未被生图工作区引用的图片。'
            : scope === 'image'
              ? '会删除生图记录及其未被对话引用的图片。'
              : '会删除对话、生图记录、图片缓存、接口配置和模板。'
    if (!window.confirm(`清除${scopeLabels[scope]}?\n\n${detail}`)) return
    await workspace.initialize()
    if (['chat', 'workspace', 'all'].includes(scope)) {
      chat.stopAll()
      chat.resetDraft()
      clearChatDrafts()
      const state = createInitialState()
      workspace.state.conversations = state.conversations
      workspace.state.activeConversationId = state.activeConversationId
    }
    if (['image', 'workspace', 'all'].includes(scope)) {
      workspace.generation++
      image.dispose()
      workspace.batches = []
      workspace.tasks = []
      workspace.images = workspace.images.map((item) => ({
        ...item,
        favoriteFolderIds: [],
      }))
      workspace.favoriteFolders = normalizeFavoriteFolders([])
      image.prompt = ''
      clearImagePromptDraft()
      image.references = []
      image.requestType = 'generation'
      ui.details.open = false
      useHistoryStore().setLibrary('history')
    }
    if (scope === 'all' || scope === 'config') {
      clearInputDrafts()
      clearProxyUrlHistory()
      usePromptTemplatesStore().dispose()
      Object.assign(workspace.state.settings, createDefaultSettings())
      workspace.state.connectionProfiles = { chat: [], image: [] }
      workspace.state.activeConnectionProfiles = { chat: '', image: '' }
      workspace.modelCatalog.chat = []
      workspace.modelCatalog.image = []
    }
    await workspace.collectUnusedImages()
    await workspace.saveAllImages()
    ui.settingsOpen = false
    ui.notify(`${scopeLabels[scope]}已清除`)
  }
  async function choose(scope: DataScope) {
    ui.dataScope.open = false
    if (ui.dataScope.action === 'export') await exportScope(scope)
    else await clearScope(scope)
  }
  return { open, choose, importFile, importProgress, exportProgress }
}

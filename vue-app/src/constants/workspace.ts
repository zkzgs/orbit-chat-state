import type { ImageOptions, Settings } from '../types/models'

export const STORAGE_KEY = 'orbit-chat-state-v1'
export const FAVORITE_STORAGE_KEY = 'orbit-image-favorite-folders-v1'
export const IMAGE_DB_NAME = 'orbit-chat-images-v1'
export const IMAGE_STORE_NAME = 'generations'
export const RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
]
export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  mediaType: 'image',
  videoDuration: 8,
  videoResolution: '720p',
  sizeMode: 'auto',
  resolution: '1K',
  ratio: 'auto',
  width: 1024,
  height: 1024,
  quality: 'auto',
  reasoningEffort: 'auto',
  format: 'png',
  compression: 0,
  background: 'auto',
  moderation: 'auto',
  count: 1,
}
export function createDefaultSettings(): Settings {
  return {
    theme: 'system',
    imageProvider: 'openai',
    chatImageTools: false,
    imageAgentInstruction: '',
    imageAgentPreview: true,
    imageAgentAutoParameters: false,
    chatHistoryImages: 'all',
    conversationSort: 'updated',
    chatImagePreview: true,
    chatSendReasoning: true,
    imageAgentRetryErrors: true,
    imageAgentRetryMismatch: true,
    imageAgentRetryLimit: 5,
    chatBaseUrl: '',
    chatApiKey: '',
    chatModel: '',
    imageBaseUrl: '',
    imageApiKey: '',
    imageModel: '',
    imageOptions: { ...DEFAULT_IMAGE_OPTIONS },
    imageCountMode: 'parameter',
    imageBackgroundMode: 'parameter',
    imagePreventPromptRewrite: true,
    persistInputContent: true,
    compressRequestImages: true,
    requestImageCompressionLimitMb: 1,
    systemPrompt: '你是一位简洁, 直接的中文助手，使用中文思考',
    reasoningEffort: 'auto',
    chatWebSearch: false,
    chatStream: true,
    imagePolishInstruction:
      '保留原始创作意图，补充主体、构图、光影、材质和画面质量细节。只输出可直接用于生图的完整提示词。',
    imagePolishSystemPrompt:
      '你是专业的图像生成提示词编辑器。严格按照用户的润色要求处理原始关键词；如果收到参考图，请结合参考图中的主体、构图、色彩、风格和视觉特征定制提示词。只输出润色后的完整提示词，不要解释。',
    imagePromptTemplates: [],
    activeImagePromptTemplateId: '',
    imagePolishTemplates: [],
    activeImagePolishTemplateId: '',
    proxyUrl: 'http://127.0.0.1:8787',
    proxyEnabled: false,
    imagePrivacyEnabled: false,
    imagePrivacyMode: 'single',
    deleteRetriedRecordOnSuccess: false,
    clearInputAfterSubmit: false,
    alwaysShowRetryButton: false,
    demoMode: false,
  }
}

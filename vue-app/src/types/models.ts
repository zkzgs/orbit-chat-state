export type WorkspaceView = 'chat' | 'image'
export type ApiKind = 'chat' | 'image'
export type DataScope = 'chat' | 'image' | 'workspace' | 'config' | 'all'
export type TaskStatus = 'running' | 'success' | 'partial' | 'error'
export interface ImageOptions {
  mediaType?: 'image' | 'video'
  videoDuration?: number
  videoResolution?: string
  sizeMode: 'auto' | 'ratio' | 'custom'
  resolution: string
  ratio: string
  width: number
  height: number
  quality: string
  reasoningEffort: string
  format: string
  compression: number
  background: string
  moderation: string
  count: number
}
export interface ImageConfig extends ImageOptions {
  provider?: ImageProvider
  requestType?: string
  model: string
  size: string
  countMode: string
  backgroundMode: string
  compressReferences: boolean
  referenceCompressionLimitMb: number
  submittedPrompt?: string
}
export interface PromptTemplate {
  id: string
  name: string
  prompt: string
  referenceImageIds: string[]
  createdAt: number
  updatedAt: number
}
export interface PolishTemplate {
  id: string
  name: string
  instruction: string
  referenceImageIds: string[]
  createdAt: number
  updatedAt: number
}
export type ImageProvider = 'openai' | 'xai' | 'gemini'
export interface Settings {
  theme: 'dark' | 'light' | 'system'
  imageProvider: ImageProvider
  chatImageTools: boolean
  imageAgentInstruction: string
  imageAgentPreview: boolean
  imageAgentAutoParameters: boolean
  chatHistoryImages: 'id' | 'all'
  conversationSort: 'updated' | 'created'
  chatImagePreview: boolean
  chatSendReasoning: boolean
  imageAgentRetryErrors: boolean
  imageAgentRetryMismatch: boolean
  imageAgentRetryLimit: number
  chatBaseUrl: string
  chatApiKey: string
  chatModel: string
  imageBaseUrl: string
  imageApiKey: string
  imageModel: string
  imageOptions: ImageOptions
  imageCountMode: string
  imageBackgroundMode: string
  imagePreventPromptRewrite: boolean
  persistInputContent: boolean
  compressRequestImages: boolean
  requestImageCompressionLimitMb: number
  systemPrompt: string
  reasoningEffort: string
  chatWebSearch: boolean
  chatStream: boolean
  imagePolishInstruction: string
  imagePolishSystemPrompt: string
  imagePromptTemplates: PromptTemplate[]
  activeImagePromptTemplateId: string
  imagePolishTemplates: PolishTemplate[]
  activeImagePolishTemplateId: string
  proxyUrl: string
  proxyEnabled: boolean
  imagePrivacyEnabled: boolean
  imagePrivacyMode: 'single' | 'list'
  deleteRetriedRecordOnSuccess: boolean
  clearInputAfterSubmit: boolean
  alwaysShowRetryButton: boolean
  demoMode: boolean
}
export interface ConnectionProfile {
  imageProvider?: ImageProvider
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models: string[]
  createdAt: number
  updatedAt: number
  reasoningEffort?: string
  countMode?: string
  backgroundMode?: string
}
export interface ChatFile {
  id: string
  name: string
  size: number
  file?: File
}
export interface AgentStep {
  type:
    | 'thinking'
    | 'tool_call'
    | 'waiting'
    | 'image'
    | 'retry'
    | 'summary'
  text?: string
  name?: string
  prompt?: string
  params?: Record<string, unknown>
  toolCallId?: string
  retryOf?: string
  retry?: boolean
  startedAt?: number
  endedAt?: number
  imageIds?: string[]
  batchId?: string
  error?: string
}
export interface Message {
  files?: ChatFile[]
  error?: string
  steps?: AgentStep[]
  toolRounds?: {
    assistant: {
      role: string
      content: string | null
      reasoning_content?: string
      tool_calls: {
        id: string
        type: string
        function: { name: string; arguments: string }
      }[]
    }
    results: { role: string; tool_call_id: string; content: string }[]
  }[]
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  imageIds: string[]
  mentionImageIds?: string[]
  createdAt: number
}
export interface ConversationChatContext {
  settings: Pick<
    Settings,
    | 'chatModel'
    | 'systemPrompt'
    | 'reasoningEffort'
    | 'chatStream'
    | 'chatWebSearch'
    | 'chatImageTools'
  >
  contextMode: 'client' | 'single'
}
export interface Conversation {
  chatContext?: ConversationChatContext
  id: string
  title: string
  createdAt: number
  updatedAt?: number
  messages: Message[]
}
export interface WorkspaceState {
  settings: Settings
  connectionProfiles: Record<ApiKind, ConnectionProfile[]>
  activeConnectionProfiles: Record<ApiKind, string>
  contextMode: 'client' | 'single'
  conversations: Conversation[]
  activeConversationId: string | null
}
export interface FavoriteFolder {
  hidden?: boolean
  // undefined: automatic, null: no cover, string: explicit image ID
  coverImageId?: string | null
  id: string
  name: string
  isDefault: boolean
}
export interface StoredImage {
  origin?: 'upload' | 'generated'
  mediaType?: 'image' | 'video'
  id: string
  type: 'image'
  src: string
  hasBlob?: boolean
  fingerprint?: string
  name?: string
  createdAt: number
  favoriteFolderIds?: string[]
  responseMeta?: Record<string, unknown>
  width?: number
  height?: number
  fileSize?: number
  format?: string
  batchId?: string
  taskId?: string
  prompt?: string
  config?: ImageConfig
}
export interface GenerationBatch {
  id: string
  type: 'generation-batch'
  batchId: string
  taskId: string
  prompt: string
  config: ImageConfig
  imageIds: string[]
  referenceImageIds: string[]
  responseMeta: Record<string, unknown>
  imageCount: number
  startedAt: number
  createdAt: number
  completedAt: number
  durationMs: number
}
export interface TaskResponse {
  requestIndex: number
  response: unknown
  receivedAt: number
}
export interface GenerationTask {
  id: string
  type: 'generation-task'
  title: string
  detail: string
  prompt: string
  config: ImageConfig
  referenceImageIds: string[]
  requestPhases: string[]
  responses: TaskResponse[]
  startedAt: number
  finishedAt?: number
  batchId?: string
  status: TaskStatus
  favoriteFolderIds?: string[]
  requestLog?: Record<string, unknown>
  error?: { message: string; occurredAt: number }
}
export type ImageRecord = StoredImage | GenerationBatch | GenerationTask
export interface ReferenceImage {
  origin?: string
  id: string
  data: string
  name: string
  file?: File
  imageId?: string
}
export interface SubmissionMeta {
  name: string
  originalSize: number
  submittedSize: number
  originalType: string
  submittedType: string
  originalWidth?: number
  originalHeight?: number
  submittedWidth?: number
  submittedHeight?: number
  compressed: boolean
  strategy: string
  targetBytes: number
  targetReached: boolean
  quality?: number
}
export interface PreparedReference {
  file: File
  data: string
  submissionMeta: SubmissionMeta
}
export interface WorkspaceExport {
  version: number
  scope: DataScope
  exportedAt: number
  contextMode?: WorkspaceState['contextMode']
  activeConversationId?: string | null
  conversations?: Conversation[]
  images?: StoredImage[]
  imageHistory?: GenerationBatch[]
  imageTasks?: GenerationTask[]
  favoriteFolders?: FavoriteFolder[]
  imageDraft?: {
    prompt: string
    referenceImageIds: string[]
    config: ImageConfig
  }
  apiConfig?: {
    settings: Settings
    connectionProfiles: WorkspaceState['connectionProfiles']
    activeConnectionProfiles: WorkspaceState['activeConnectionProfiles']
    modelCatalog: Record<ApiKind, string[]>
  }
}

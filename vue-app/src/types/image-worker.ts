export interface ImageInfo {
  width: number
  height: number
  detectedFormat: string
  format: string
  fileSize: number
  hasTransparency?: boolean
}

export interface CompressedImage {
  compressed: boolean
  originalWidth: number
  originalHeight: number
  blob?: Blob
  submittedWidth?: number
  submittedHeight?: number
  quality?: number
  targetReached?: boolean
}

export interface ImageResponseItem {
  id?: string
  revised_prompt?: string
  model?: string
  created?: number
  output_format?: string
  size?: string
  b64_json?: string
  url?: string
}

export interface ImageResponse {
  data?: (string | ImageResponseItem)[]
  model?: string
  created?: number
  id?: string
  usage?: unknown
  error?: { message?: string }
  message?: string
  detail?: string
}

export interface ParsedImageResponse {
  images: { src: string; responseMeta: Record<string, unknown> }[]
  apiResponse: unknown
  responseModel: string
  created?: number
  id?: string
  usage?: unknown
  parsed: boolean
  errorMessage: string
}

export interface WorkerPayloads {
  fileToDataUrl: { file: Blob }
  blobToDataUrl: { blob: Blob }
  dataUrlToBlob: { dataUrl: string }
  inspectImage: { blob: Blob }
  compressImage: { file: File; targetBytes: number }
  convertToPng: { blob: Blob }
  createThumbnail: { blob: Blob }
  parseImageResponse: { raw: string; endpoint: string; isEdit: boolean }
}

export interface WorkerResults {
  fileToDataUrl: string
  blobToDataUrl: string
  dataUrlToBlob: Blob
  inspectImage: ImageInfo
  compressImage: CompressedImage
  convertToPng: Blob
  createThumbnail: Blob
  parseImageResponse: ParsedImageResponse
}

export type WorkerRequest = {
  [K in keyof WorkerPayloads]: {
    id: number
    type: K
    payload: WorkerPayloads[K]
  }
}[keyof WorkerPayloads]

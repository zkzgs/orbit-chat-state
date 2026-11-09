import type {
  Conversation,
  GenerationBatch,
  GenerationTask,
  Settings,
  StoredImage,
  FavoriteFolder,
} from '../types/models'
import { createId } from '../utils/id'
import { normalizeFavoriteFolders } from './state'

export function combineRecords<T extends { id: string }>(old: T[], added: T[]) {
  return [
    ...new Map([...old, ...added].map((item) => [item.id, item])).values(),
  ]
}

export function combineNamedRecords<T extends { id: string; name: string }>(
  old: T[],
  added: T[],
) {
  return [...old, ...added].reduce<T[]>(
    (result, record) =>
      result
        .filter(
          (item) =>
            item.id !== record.id &&
            item.name.trim().toLowerCase() !== record.name.trim().toLowerCase(),
        )
        .concat(record),
    [],
  )
}

export function collectImageIds(
  conversations: Conversation[],
  batches: GenerationBatch[],
  tasks: GenerationTask[],
  settings?: Settings,
) {
  return new Set([
    ...conversations.flatMap((item) =>
      item.messages.flatMap((message) => message.imageIds || []),
    ),
    ...batches.flatMap((item) => [
      ...item.imageIds,
      ...(item.referenceImageIds || []),
    ]),
    ...tasks.flatMap((item) => item.referenceImageIds || []),
    ...(settings
      ? [
          ...settings.imagePromptTemplates,
          ...settings.imagePolishTemplates,
        ].flatMap((item) => item.referenceImageIds)
      : []),
  ])
}

export async function mergeImages(
  base: StoredImage[],
  incoming: StoredImage[],
  onProgress?: (progress: number) => void,
) {
  const records = new Map(base.map((item) => [item.id, item]))
  const idMap = new Map<string, string>()
  const contentStart = (src: string) =>
    src.startsWith('data:') ? src.indexOf(',') + 1 : 0
  const fingerprint = async (src: string) => {
    const start = contentStart(src)
    let first = 2166136261
    let second = 2246822519
    for (let i = start; i < src.length; i++) {
      const code = src.charCodeAt(i)
      first = Math.imul(first ^ code, 16777619)
      second = Math.imul(second ^ code, 3266489917)
      if (i > start && (i - start) % (256 * 1024) === 0)
        await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
    return `${src.length - start}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`
  }
  const sameImage = async (first: string, second: string) => {
    const firstStart = contentStart(first)
    const secondStart = contentStart(second)
    const length = first.length - firstStart
    if (length !== second.length - secondStart) return false
    for (let offset = 0; offset < length; offset += 256 * 1024) {
      if (
        first.slice(firstStart + offset, firstStart + offset + 256 * 1024) !==
        second.slice(secondStart + offset, secondStart + offset + 256 * 1024)
      )
        return false
      if (offset && offset % (4 * 1024 * 1024) === 0)
        await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
    return true
  }
  const fingerprints = new Map<string, string[]>()
  function indexImage(image: StoredImage, key: string) {
    const ids = fingerprints.get(key) || []
    ids.push(image.id)
    fingerprints.set(key, ids)
  }
  for (let i = 0; i < base.length; i++) {
    const image = base[i]
    indexImage(image, await fingerprint(image.src))
    if (i % 8 === 0) {
      onProgress?.(base.length ? ((i + 1) / base.length) * 0.2 : 0.2)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
  for (let i = 0; i < incoming.length; i++) {
    const source = incoming[i]
    const key = await fingerprint(source.src)
    const sameId = records.get(source.id)
    let same =
      sameId && (await sameImage(sameId.src, source.src)) ? sameId : undefined
    if (!same) {
      for (const id of fingerprints.get(key) || []) {
        const candidate = records.get(id)!
        if (await sameImage(candidate.src, source.src)) {
          same = candidate
          break
        }
      }
    }
    const id = same?.id || (records.has(source.id) ? createId() : source.id)
    idMap.set(source.id, id)
    const record = { ...source, id, type: 'image' as const }
    records.set(id, record)
    if (!same) indexImage(record, key)
    if (i % 8 === 0) {
      onProgress?.(0.2 + ((i + 1) / Math.max(incoming.length, 1)) * 0.8)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
  onProgress?.(1)
  return {
    records: [...records.values()],
    remap: (ids: string[] = []) => [
      ...new Set(ids.map((id) => idMap.get(id) || id)),
    ],
  }
}

export function mergeFolders(
  existing: FavoriteFolder[],
  incoming: FavoriteFolder[],
) {
  const folders = existing.map((item) => ({ ...item }))
  const idMap = new Map<string, string>()
  for (const folder of incoming) {
    const same = folders.find(
      (item) =>
        item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase(),
    )
    const id =
      same?.id ||
      (folders.some((item) => item.id === folder.id) ? createId() : folder.id)
    idMap.set(folder.id, id)
    if (same) same.hidden = Boolean(same.hidden || folder.hidden)
    if (!same) folders.push({ ...folder, id, isDefault: false })
  }
  return {
    folders: normalizeFavoriteFolders(folders),
    remap: (ids: string[] = []) => [
      ...new Set(ids.map((id) => idMap.get(id) || id)),
    ],
  }
}

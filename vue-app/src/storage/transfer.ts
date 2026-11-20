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
import { imageStorage } from './database'
import { agentImageIds } from '../api/image-agent.js'

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
      item.messages.flatMap((message) => [
        ...(message.imageIds || []),
        ...(message.mentionImageIds || []),
        ...agentImageIds(message),
      ]),
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
  protectedIds = new Set<string>(),
) {
  const records = new Map(base.map((item) => [item.id, item]))
  const idMap = new Map<string, string>()
  const fingerprint = (src: string) => imageStorage.fingerprint(src)
  const fingerprints = new Map<string, string[]>()
  function indexImage(image: StoredImage, key: string) {
    const ids = fingerprints.get(key) || []
    if (!ids.includes(image.id)) ids.push(image.id)
    fingerprints.set(key, ids)
  }
  for (let i = 0; i < base.length; i++) {
    const image = base[i]
    const key = image.fingerprint || (await fingerprint(image.src))
    image.fingerprint = key
    indexImage(image, key)
    if (i % 8 === 0) {
      onProgress?.(base.length ? ((i + 1) / base.length) * 0.2 : 0.2)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
  for (let i = 0; i < incoming.length; i++) {
    const source = incoming[i]
    const key = source.fingerprint || (await fingerprint(source.src))
    source.fingerprint = key
    const sameId = records.get(source.id)
    const sameIdKey =
      sameId && (sameId.fingerprint || (await fingerprint(sameId.src)))
    if (sameId && sameIdKey) sameId.fingerprint = sameIdKey
    if (
      sameId &&
      sameIdKey &&
      sameIdKey !== key &&
      !protectedIds.has(source.id)
    )
      fingerprints.set(
        sameIdKey,
        (fingerprints.get(sameIdKey) || []).filter((id) => id !== sameId.id),
      )
    // 指纹已覆盖全部字节, 相同指纹视为同一张图, 避免手机上再逐字节比对。
    let same =
      sameId && (!protectedIds.has(source.id) || sameIdKey === key)
        ? sameId
        : undefined
    if (!same) {
      const id = (fingerprints.get(key) || [])[0]
      if (id) same = records.get(id)
    }
    const id = same?.id || (records.has(source.id) ? createId() : source.id)
    idMap.set(source.id, id)
    const record = {
      ...source,
      id,
      type: 'image' as const,
      fingerprint: key,
      ...(same?.origin === 'generated' || same?.batchId
        ? { origin: 'generated' as const }
        : {}),
    }
    records.set(id, record)
    indexImage(record, key)
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
    const same =
      folders.find((item) => item.id === folder.id) ||
      folders.find(
        (item) =>
          item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase(),
      )
    const id =
      same?.id ||
      (folders.some((item) => item.id === folder.id) ? createId() : folder.id)
    idMap.set(folder.id, id)
    if (same) Object.assign(same, folder, { id })
    if (!same) folders.push({ ...folder, id, isDefault: false })
  }
  return {
    folders: normalizeFavoriteFolders(folders),
    remap: (ids: string[] = []) => [
      ...new Set(ids.map((id) => idMap.get(id) || id)),
    ],
  }
}

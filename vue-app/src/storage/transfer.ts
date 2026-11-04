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

export function mergeImages(base: StoredImage[], incoming: StoredImage[]) {
  const records = new Map(base.map((item) => [item.id, item]))
  const idMap = new Map<string, string>()
  const identity = (src: string) =>
    src.startsWith('data:') ? src.slice(src.indexOf(',') + 1) : src
  for (const source of incoming) {
    const same = [...records.values()].find(
      (item) => identity(item.src) === identity(source.src),
    )
    const id = same?.id || (records.has(source.id) ? createId() : source.id)
    idMap.set(source.id, id)
    records.set(id, { ...source, id, type: 'image' })
  }
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
    if (!same) folders.push({ ...folder, id, isDefault: false })
  }
  return {
    folders: normalizeFavoriteFolders(folders),
    remap: (ids: string[] = []) => [
      ...new Set(ids.map((id) => idMap.get(id) || id)),
    ],
  }
}

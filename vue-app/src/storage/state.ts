import type { FavoriteFolder, WorkspaceState } from '../types/models'
import {
  createDefaultSettings,
  FAVORITE_STORAGE_KEY,
  STORAGE_KEY,
} from '../constants/workspace'
import { createId } from '../utils/id'

export function createInitialState(): WorkspaceState {
  const id = createId()
  return {
    settings: createDefaultSettings(),
    connectionProfiles: { chat: [], image: [] },
    activeConnectionProfiles: { chat: '', image: '' },
    contextMode: 'client',
    conversations: [
      { id, title: '新对话', createdAt: Date.now(), messages: [] },
    ],
    activeConversationId: id,
  }
}
export function loadState(): WorkspaceState {
  const initial = createInitialState()
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null',
    ) as WorkspaceState | null
    if (!saved) return initial
    return {
      ...initial,
      ...saved,
      settings: {
        ...initial.settings,
        ...saved.settings,
        imageOptions: {
          ...initial.settings.imageOptions,
          ...saved.settings?.imageOptions,
        },
      },
      connectionProfiles: {
        ...initial.connectionProfiles,
        ...saved.connectionProfiles,
      },
      activeConnectionProfiles: {
        ...initial.activeConnectionProfiles,
        ...saved.activeConnectionProfiles,
      },
      conversations: saved.conversations?.length
        ? saved.conversations
        : initial.conversations,
    }
  } catch {
    return initial
  }
}
export function saveState(state: WorkspaceState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 浏览器禁止本地存储时保留页面内状态 */
  }
}
export function normalizeFavoriteFolders(
  folders: FavoriteFolder[],
): FavoriteFolder[] {
  const result = [
    ...new Map(
      folders
        .filter((folder) => folder.name.trim())
        .map((folder) => [folder.id, { ...folder }]),
    ).values(),
  ]
  if (!result.length)
    result.push({
      id: 'favorites-default',
      name: '默认收藏夹',
      isDefault: true,
    })
  const active = result.find((folder) => folder.isDefault) || result[0]
  return result.map((folder) => ({
    ...folder,
    isDefault: folder.id === active.id,
  }))
}
export function loadFavoriteFolders() {
  try {
    return normalizeFavoriteFolders(
      JSON.parse(
        localStorage.getItem(FAVORITE_STORAGE_KEY) || '[]',
      ) as FavoriteFolder[],
    )
  } catch {
    return normalizeFavoriteFolders([])
  }
}
export function saveFavoriteFolders(folders: FavoriteFolder[]) {
  try {
    localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(folders))
  } catch {
    /* 页面内收藏仍可使用 */
  }
}

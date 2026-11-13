const INPUT_DRAFTS_KEY = 'orbit-input-drafts-v1'

function readDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(INPUT_DRAFTS_KEY) || '{}')
    return {
      imagePrompt:
        typeof value.imagePrompt === 'string' ? value.imagePrompt : '',
      chat: value.chat && typeof value.chat === 'object' ? value.chat : {},
    }
  } catch {
    return { imagePrompt: '', chat: {} }
  }
}

function updateDrafts(update) {
  try {
    const drafts = readDrafts()
    update(drafts)
    if (!drafts.imagePrompt && !Object.keys(drafts.chat).length)
      localStorage.removeItem(INPUT_DRAFTS_KEY)
    else localStorage.setItem(INPUT_DRAFTS_KEY, JSON.stringify(drafts))
  } catch {}
}

export function readImagePromptDraft() {
  return readDrafts().imagePrompt
}

export function saveImagePromptDraft(value) {
  updateDrafts((drafts) => {
    drafts.imagePrompt = value
  })
}

export function clearImagePromptDraft() {
  saveImagePromptDraft('')
}

export function readChatDraft(id) {
  const value = readDrafts().chat[id]
  return typeof value === 'string' ? value : undefined
}

export function saveChatDraft(id, value) {
  updateDrafts((drafts) => {
    if (value) drafts.chat[id] = value
    else delete drafts.chat[id]
  })
}

export function removeChatDraft(id) {
  updateDrafts((drafts) => {
    delete drafts.chat[id]
  })
}

export function clearChatDrafts() {
  updateDrafts((drafts) => {
    drafts.chat = {}
  })
}

export function clearInputDrafts() {
  try {
    localStorage.removeItem(INPUT_DRAFTS_KEY)
  } catch {}
}

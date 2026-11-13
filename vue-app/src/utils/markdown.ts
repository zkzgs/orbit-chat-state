import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { createMarkdownRenderer } from './markdown-renderer.js'

export function escapeHtml(value: unknown) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ]!,
  )
}

export const renderMarkdown = createMarkdownRenderer(marked, DOMPurify)

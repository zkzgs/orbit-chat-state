import { onMounted, onScopeDispose } from 'vue'
import { useEventListener } from './useEventListener'

// Delegation also covers progressively mounted cards and dialogs, like the HTML app.
export function useTooltips() {
  let node: HTMLDivElement | null = null
  let active: HTMLElement | null = null
  const selector = '[data-tooltip], [title], button[aria-label]'
  function hide() {
    node?.classList.remove('show')
    if (node) node.hidden = true
    active = null
  }
  function show(target: HTMLElement) {
    const title = target.getAttribute('title')
    const text =
      title || target.dataset.tooltip || target.getAttribute('aria-label')
    if (!text || !node || target.closest('[hidden]')) return
    if (/^关闭/.test(text)) {
      target.removeAttribute('title')
      delete target.dataset.tooltip
      hide()
      return
    }
    if (title) {
      target.dataset.tooltip = title
      target.removeAttribute('title')
    }
    // Avoid repeating the text of a visible label; retain icon-only help.
    if (
      target.matches('.settings-tabs button') ||
      target.innerText.replace(/\s+/g, '') === text.replace(/\s+/g, '')
    ) {
      hide()
      return
    }
    active = target
    node.textContent = text
    node.hidden = false
    node.classList.add('show')
    const rect = target.getBoundingClientRect()
    const bounds = node.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, window.innerWidth - bounds.width - 8))}px`
    node.style.top = `${rect.top >= bounds.height + 16 ? rect.top - bounds.height - 8 : rect.bottom + 8}px`
  }
  onMounted(() => {
    node = document.createElement('div')
    node.className = 'custom-tooltip'
    node.setAttribute('role', 'tooltip')
    node.hidden = true
    document.body.appendChild(node)
  })
  useEventListener(document, 'pointerover', (event) => {
    const e = event as PointerEvent
    const target = (e.target as Element)?.closest<HTMLElement>(selector)
    if (
      target &&
      !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))
    )
      show(target)
  })
  useEventListener(document, 'pointerout', (event) => {
    const e = event as PointerEvent
    if (
      active &&
      !(e.relatedTarget instanceof Node && active.contains(e.relatedTarget))
    )
      hide()
  })
  useEventListener(document, 'focusin', (event) => {
    const target = (event.target as Element)?.closest<HTMLElement>(selector)
    if (target) show(target)
  })
  useEventListener(document, 'focusout', hide)
  useEventListener(document, 'click', hide)
  useEventListener(document, 'scroll', hide, { capture: true })
  useEventListener(window, 'resize', hide)
  useEventListener(window, 'keydown', (event) => {
    if (event.key === 'Escape') hide()
  })
  onScopeDispose(() => node?.remove())
}

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
  type Ref,
} from 'vue'

type MentionSegment = {
  type: 'text' | 'mention' | 'caret'
  text: string
  index: number
  start: number
}

type MentionOption = { label: string; index: number }

export function useImageMentions(
  model: Ref<string>,
  labels: () => string[],
  input: Readonly<Ref<HTMLTextAreaElement | null>>,
  mirror: Readonly<Ref<HTMLDivElement | null>>,
  menu: Readonly<Ref<HTMLDivElement | null>>,
  wrap: Readonly<Ref<HTMLDivElement | null>>,
  options: { strictMentions?: boolean; enabled?: () => boolean } = {},
) {
  const caret = ref(0)
  const focused = ref(false)
  const composing = ref(false)
  const dismissed = ref(false)
  const menuIndex = ref(0)
  const menuStyle = ref<CSSProperties>({ left: '0px', top: '0px' })
  const query = computed(() => {
    const element = input.value
    const position = caret.value
    if (
      !focused.value ||
      composing.value ||
      dismissed.value ||
      options.enabled?.() === false ||
      !element ||
      element.selectionStart !== element.selectionEnd
    )
      return null
    const match = model.value.slice(0, position).match(/@([^\s@]*)$/)
    if (!match) return null
    if (!options.strictMentions && /^[\d?]/.test(model.value.slice(position)))
      return null
    if (options.strictMentions) {
      const insideMention = [
        ...model.value.matchAll(/@(图|生成参考图|润色参考图)(?:\d+|\?)/g),
      ].some(
        (item) =>
          position > item.index! && position <= item.index! + item[0].length,
      )
      if (insideMention) return null
    }
    return {
      text: match[1],
      start: position - match[0].length,
      end: position,
    }
  })
  const suggestions = computed<MentionOption[]>(() => {
    const current = query.value
    if (!current) return []
    return labels().flatMap((label, index) => {
      if (!label) return []
      if (!options.strictMentions) {
        const match = current.text.match(/^(?:图)?(\d*)$/)
        return match && String(index + 1).startsWith(match[1])
          ? [{ label, index }]
          : []
      }
      const alias = label.replace('@生成参考图', '图')
      return label.slice(1).startsWith(current.text) ||
        alias.startsWith(current.text)
        ? [{ label, index }]
        : []
    })
  })
  const showMenu = computed(() => suggestions.value.length > 0)
  const segments = computed<MentionSegment[]>(() => {
    const value = model.value
    const result: MentionSegment[] = []
    let start = 0
    let insertedCaret = false
    function appendText(text: string, offset: number) {
      if (
        !insertedCaret &&
        caret.value >= offset &&
        caret.value <= offset + text.length
      ) {
        const split = caret.value - offset
        if (split)
          result.push({
            type: 'text',
            text: text.slice(0, split),
            index: -1,
            start: offset,
          })
        result.push({ type: 'caret', text: '', index: -1, start: caret.value })
        if (split < text.length)
          result.push({
            type: 'text',
            text: text.slice(split),
            index: -1,
            start: caret.value,
          })
        insertedCaret = true
      } else if (text) {
        result.push({ type: 'text', text, index: -1, start: offset })
      }
    }
    for (const match of value.matchAll(
      /@(图|生成参考图|润色参考图)(\d+|\?)/g,
    )) {
      const matchStart = match.index!
      appendText(value.slice(start, matchStart), start)
      const token = match[0]
      let imageIndex = labels().indexOf(token)
      if (imageIndex < 0 && match[1] === '图')
        imageIndex = labels().indexOf(`@生成参考图${match[2]}`)
      result.push({
        type: 'mention',
        text: token,
        index: imageIndex,
        start: matchStart,
      })
      start = matchStart + token.length
    }
    appendText(value.slice(start), start)
    if (!insertedCaret && caret.value === value.length)
      result.push({ type: 'caret', text: '', index: -1, start: caret.value })
    result.push({ type: 'text', text: '\n', index: -1, start: value.length })
    return result
  })

  async function positionMenu() {
    if (!showMenu.value || !menu.value || !wrap.value) return
    await nextTick()
    if (!showMenu.value || !menu.value || !wrap.value) return
    const marker = mirror.value?.querySelector<HTMLElement>(
      '.image-mention-caret',
    )
    const container = wrap.value
    const bounds = container.getBoundingClientRect()
    const position =
      marker?.getBoundingClientRect() || input.value?.getBoundingClientRect()
    const popup = menu.value
    if (!position) return
    const left = Math.max(
      0,
      Math.min(position.left - bounds.left, bounds.width - popup.offsetWidth),
    )
    const boundary = container.closest('.image-generator-column, .polish-modal')
    const visibleBottom = Math.min(
      window.innerHeight,
      boundary?.getBoundingClientRect().bottom || window.innerHeight,
    )
    const below = position.bottom - bounds.top + 6
    const top =
      position.bottom + 6 + popup.offsetHeight > visibleBottom
        ? Math.max(0, position.top - bounds.top - popup.offsetHeight - 6)
        : below
    menuStyle.value = { left: `${left}px`, top: `${top}px` }
  }

  function updateCaret() {
    caret.value = input.value?.selectionStart || 0
    menuIndex.value = 0
    dismissed.value = false
  }

  function syncScroll() {
    if (!input.value || !mirror.value) return
    mirror.value.scrollTop = input.value.scrollTop
    mirror.value.scrollLeft = input.value.scrollLeft
    void positionMenu()
  }

  async function insert(optionIndex: number) {
    const option = suggestions.value[optionIndex]
    const current = query.value
    if (!option || !current) return
    model.value =
      model.value.slice(0, current.start) +
      option.label +
      model.value.slice(current.end)
    dismissed.value = true
    await nextTick()
    input.value?.focus()
    caret.value = current.start + option.label.length
    input.value?.setSelectionRange(caret.value, caret.value)
  }

  async function insertReference(index: number) {
    const label = labels()[index]
    const element = input.value
    if (!label || !element || options.enabled?.() === false) return
    const start = element.selectionStart
    const end = element.selectionEnd
    model.value = model.value.slice(0, start) + label + model.value.slice(end)
    await nextTick()
    element.focus()
    caret.value = start + label.length
    element.setSelectionRange(caret.value, caret.value)
    dismissed.value = true
  }

  function keydown(event: KeyboardEvent) {
    if (!showMenu.value) return
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      menuIndex.value =
        (menuIndex.value +
          (event.key === 'ArrowDown' ? 1 : -1) +
          suggestions.value.length) %
        suggestions.value.length
      void nextTick(() =>
        menu.value
          ?.querySelectorAll<HTMLButtonElement>('.image-mention-option')
          .item(menuIndex.value)
          ?.scrollIntoView({ block: 'nearest' }),
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void insert(menuIndex.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismissed.value = true
    }
  }

  function compositionStart() {
    composing.value = true
  }

  function compositionEnd() {
    composing.value = false
    updateCaret()
  }

  function blur() {
    window.setTimeout(() => {
      if (document.activeElement !== input.value) focused.value = false
    }, 120)
  }

  function placeCaret(segment: MentionSegment) {
    if (segment.index < 0) return
    const position = segment.start + segment.text.length
    input.value?.focus()
    input.value?.setSelectionRange(position, position)
    caret.value = position
    dismissed.value = false
  }

  function onResize() {
    void positionMenu()
  }

  watch([showMenu, suggestions], () => void positionMenu(), { flush: 'post' })
  onMounted(() => window.addEventListener('resize', onResize))
  onBeforeUnmount(() => window.removeEventListener('resize', onResize))

  return {
    focused,
    menuIndex,
    menuStyle,
    showMenu,
    suggestions,
    segments,
    updateCaret,
    syncScroll,
    insert,
    insertReference,
    keydown,
    compositionStart,
    compositionEnd,
    blur,
    placeCaret,
  }
}

export function gridScroller(element) {
  return matchMedia('(max-width: 780px)').matches
    ? element.closest('.content-stage') || element
    : element
}

export function gridLayout(element, count) {
  const style = getComputedStyle(element)
  const columns = Math.max(
    1,
    style.gridTemplateColumns.split(' ').filter(Boolean).length,
  )
  const gap = parseFloat(style.rowGap) || 10
  const top = parseFloat(style.paddingTop) || 0
  const row = 274 + gap
  const rows = Math.ceil(count / columns)
  const scroller = gridScroller(element)
  const scrollTop =
    scroller === element
      ? element.scrollTop
      : scroller.getBoundingClientRect().top -
        element.getBoundingClientRect().top
  const first = Math.max(0, Math.floor((scrollTop - top) / row) - 2)
  const last = Math.min(
    rows,
    Math.max(2, Math.ceil((scrollTop + scroller.clientHeight - top) / row) + 2),
  )
  const start = Math.min(first, Math.max(0, rows - 1)) * columns
  const end = Math.min(count, last * columns)
  return {
    columns,
    gap,
    top,
    row,
    start,
    end,
    before: start ? (start / columns) * row - gap : 0,
    after: end < count ? (rows - Math.ceil(end / columns)) * row - gap : 0,
  }
}

// 命中检测按网格坐标计算, 仅测量列表, 不逐张读取卡片布局。
export function createGridSelection(list, options) {
  let drag
  let frame = 0
  let suppress = false
  const box = document.createElement('div')
  box.className = 'history-drag-select'
  box.hidden = true
  document.body.appendChild(box)
  function draw() {
    if (!drag?.active) return
    const rect = list.getBoundingClientRect()
    const edge = 48
    if (drag.y < rect.top + edge)
      list.scrollTop -= Math.min(18, (rect.top + edge - drag.y) / 3)
    else if (drag.y > rect.bottom - edge)
      list.scrollTop += Math.min(18, (drag.y - rect.bottom + edge) / 3)
    const x = Math.max(rect.left, Math.min(rect.right, drag.x)) - rect.left
    const y =
      Math.max(rect.top, Math.min(rect.bottom, drag.y)) -
      rect.top +
      list.scrollTop
    const left = Math.min(drag.startX, x),
      right = Math.max(drag.startX, x)
    const top = Math.min(drag.startY, y),
      bottom = Math.max(drag.startY, y)
    const keys = options.keys()
    const layout = gridLayout(list, keys.length)
    const width =
      (list.clientWidth - (layout.columns - 1) * layout.gap) / layout.columns
    const selected = new Set(drag.before)
    const firstRow = Math.max(0, Math.floor((top - layout.top) / layout.row))
    const lastRow = Math.min(
      Math.ceil(keys.length / layout.columns) - 1,
      Math.floor((bottom - layout.top) / layout.row),
    )
    for (let row = firstRow; row <= lastRow; row++) {
      if (
        top >= layout.top + row * layout.row + 274 ||
        bottom <= layout.top + row * layout.row
      )
        continue
      for (let column = 0; column < layout.columns; column++) {
        if (
          left >= column * (width + layout.gap) + width ||
          right <= column * (width + layout.gap)
        )
          continue
        const key = keys[row * layout.columns + column]
        if (key) {
          if (selected.has(key)) selected.delete(key)
          else selected.add(key)
        }
      }
    }
    options.change(selected)
    const screenTop = Math.max(rect.top, rect.top + top - list.scrollTop)
    const screenBottom = Math.min(
      rect.bottom,
      rect.top + bottom - list.scrollTop,
    )
    Object.assign(box.style, {
      left: `${rect.left + left}px`,
      top: `${screenTop}px`,
      width: `${right - left}px`,
      height: `${Math.max(0, screenBottom - screenTop)}px`,
    })
    frame = requestAnimationFrame(draw)
  }
  function down(event) {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      matchMedia('(max-width: 780px), (hover: none) and (pointer: coarse)')
        .matches
    )
      return
    if (
      event.target.closest(
        '.history-actions, .history-select, .favorite-folder-card, input, select, .history-empty',
      )
    )
      return
    const rect = list.getBoundingClientRect()
    drag = {
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top + list.scrollTop,
      before: new Set(options.selected()),
      active: false,
    }
  }
  function move(event) {
    if (!drag) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (
      !drag.active &&
      Math.hypot(drag.x - drag.originX, drag.y - drag.originY) >= 5
    ) {
      drag.active = true
      list.classList.add('is-selecting')
      box.hidden = false
      draw()
    }
    if (drag.active) event.preventDefault()
  }
  function up() {
    if (!drag) return
    suppress = drag.active
    if (suppress)
      setTimeout(() => {
        suppress = false
      }, 0)
    drag = undefined
    cancelAnimationFrame(frame)
    box.hidden = true
    list.classList.remove('is-selecting')
  }
  function click(event) {
    if (suppress) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  list.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  list.addEventListener('click', click, true)
  return () => {
    up()
    box.remove()
    list.removeEventListener('pointerdown', down)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    list.removeEventListener('click', click, true)
  }
}

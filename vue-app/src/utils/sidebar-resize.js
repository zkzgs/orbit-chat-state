export function bindSidebarResize(sidebar, handle, onCollapse) {
  let expandedWidth = 274
  const resize = (width) => {
    const next = Math.round(
      Math.max(160, Math.min(width, 520, window.innerWidth - 360)),
    )
    sidebar.style.setProperty('--sidebar-width', `${next}px`)
    handle.setAttribute('aria-valuenow', String(next))
  }
  const start = (event) => {
    if (event.button !== 0 || window.innerWidth <= 780) return
    event.preventDefault()
    expandedWidth = sidebar.getBoundingClientRect().width
    handle.setPointerCapture(event.pointerId)
    document.documentElement.classList.add('resizing-sidebar')
  }
  const move = (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return
    if (event.clientX < 160) {
      handle.releasePointerCapture(event.pointerId)
      resize(Math.max(210, expandedWidth))
      onCollapse()
    } else resize(event.clientX)
  }
  const stop = () =>
    document.documentElement.classList.remove('resizing-sidebar')
  const keydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const width =
      sidebar.getBoundingClientRect().width +
      (event.key === 'ArrowRight' ? 16 : -16)
    if (width < 160) {
      resize(210)
      onCollapse()
    } else resize(width)
  }
  handle.addEventListener('pointerdown', start)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('lostpointercapture', stop)
  handle.addEventListener('keydown', keydown)
  return () => {
    handle.removeEventListener('pointerdown', start)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('lostpointercapture', stop)
    handle.removeEventListener('keydown', keydown)
    stop()
  }
}

export function bindSidebarTitles(list) {
  let active
  let original = ''
  function reset() {
    if (!active) return
    observer.unobserve(active)
    active.textContent = original
    active.classList.remove('scrolling-title')
    active = undefined
  }
  function update() {
    const title = active
    if (!title) return
    const text = title.querySelector('.conversation-title-track > span')
    const width = text ? text.getBoundingClientRect().width : title.scrollWidth
    if (width <= title.clientWidth + 1) {
      if (text) {
        title.textContent = original
        title.classList.remove('scrolling-title')
      }
      return
    }
    if (text) return
    const track = document.createElement('span')
    track.className = 'conversation-title-track'
    const label = document.createElement('span')
    label.textContent = original
    track.append(label)
    const copy = label.cloneNode(true)
    copy.setAttribute('aria-hidden', 'true')
    track.append(copy)
    title.replaceChildren(track)
    title.classList.add('scrolling-title')
    const distance = label.getBoundingClientRect().width + 28
    track.style.setProperty('--title-distance', `${-distance}px`)
    track.style.setProperty(
      '--title-duration',
      `${Math.max(5, distance / 38)}s`,
    )
  }
  const observer = new ResizeObserver(update)
  function enter(event) {
    const row = event.target.closest?.('.conversation-row')
    if (!row || row.contains(event.relatedTarget)) return
    reset()
    const title = row.querySelector('.conversation-title')
    if (!title || !row.querySelector('.conversation-actions')) return
    original = title.textContent
    active = title
    observer.observe(title)
    update()
  }
  function leave(event) {
    const row = active?.closest('.conversation-row')
    if (row && !row.contains(event.relatedTarget)) reset()
  }
  list.addEventListener('pointerover', enter)
  list.addEventListener('pointerout', leave)
  return () => {
    reset()
    observer.disconnect()
    list.removeEventListener('pointerover', enter)
    list.removeEventListener('pointerout', leave)
  }
}

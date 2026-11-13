export function createMarkdownRenderer(markdown, purifier) {
  const renderer = new markdown.Renderer()
  renderer.html = ({ text }) =>
    text.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    )
  return (value) => {
    const html = markdown.parse(String(value || ''), {
      gfm: true,
      breaks: true,
      async: false,
      renderer,
    })
    const safe = purifier.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
      FORBID_ATTR: ['style', 'id', 'name'],
      RETURN_DOM_FRAGMENT: true,
    })
    safe.querySelectorAll('a').forEach((link) => {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    })
    safe.querySelectorAll('img').forEach((image) => {
      image.className = 'markdown-inline-image'
      image.loading = 'lazy'
    })
    safe.querySelectorAll('table').forEach((table) => {
      const wrap = document.createElement('div')
      wrap.className = 'markdown-table-wrap'
      table.replaceWith(wrap)
      wrap.append(table)
    })
    const container = document.createElement('div')
    container.append(safe)
    return container.innerHTML || '<p></p>'
  }
}

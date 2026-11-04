export function escapeHtml(value: unknown) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ]!,
  )
}

export function renderMarkdown(value: string | null | undefined) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const output: string[] = []
  let paragraph: string[] = []
  let listType = ''
  let codeLines: string[] | null = null

  const inline = (text: string) => {
    let html = escapeHtml(text)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    html = html.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      '<img class="markdown-inline-image" src="$2" alt="$1">',
    )
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    )
    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    html = html
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>')
    return html
  }
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`)
      listType = ''
    }
  }
  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(
        `<p>${inline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`,
      )
      paragraph = []
    }
  }
  const flushCode = () => {
    if (codeLines) {
      output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      codeLines = null
    }
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (codeLines) flushCode()
      else {
        flushParagraph()
        closeList()
        codeLines = []
      }
      return
    }
    if (codeLines) {
      codeLines.push(line)
      return
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/)
    if (!line.trim()) {
      flushParagraph()
      closeList()
      return
    }
    if (heading) {
      flushParagraph()
      closeList()
      output.push(
        `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`,
      )
      return
    }
    if (line.trim().startsWith('>')) {
      flushParagraph()
      closeList()
      output.push(
        `<blockquote>${inline(line.trim().replace(/^>\s?/, ''))}</blockquote>`,
      )
      return
    }
    if (list) {
      flushParagraph()
      const nextType = /^\d/.test(list[1]) ? 'ol' : 'ul'
      if (listType !== nextType) {
        closeList()
        listType = nextType
        output.push(`<${listType}>`)
      }
      output.push(`<li>${inline(list[2])}</li>`)
      return
    }
    closeList()
    paragraph.push(line)
  })
  flushParagraph()
  closeList()
  flushCode()
  return output.join('') || '<p></p>'
}

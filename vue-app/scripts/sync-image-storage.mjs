import { readFile, writeFile } from 'node:fs/promises'

const htmlPath = new URL('../../index.html', import.meta.url)
const source = (
  await readFile(
    new URL('../src/storage/image-assets.js', import.meta.url),
    'utf8',
  )
)
  .replace('export function createImageStorage', 'function createImageStorage')
  .trim()
const start = '// BEGIN SHARED IMAGE STORAGE'
const end = '// END SHARED IMAGE STORAGE'
let html = await readFile(htmlPath, 'utf8')
const inputDrafts = (
  await readFile(
    new URL('../src/storage/input-drafts.js', import.meta.url),
    'utf8',
  )
)
  .replaceAll('export function ', 'function ')
  .trim()
const inputDraftsBlock =
  '// BEGIN SHARED INPUT DRAFTS\n' +
  inputDrafts +
  '\n// END SHARED INPUT DRAFTS'
const inputDraftsStart = html.indexOf('// BEGIN SHARED INPUT DRAFTS')
if (inputDraftsStart >= 0)
  html =
    html.slice(0, inputDraftsStart) +
    inputDraftsBlock +
    html.slice(
      html.indexOf('// END SHARED INPUT DRAFTS', inputDraftsStart) +
        '// END SHARED INPUT DRAFTS'.length,
    )
else html = html.replace('<script>\n', '<script>\n' + inputDraftsBlock + '\n\n')
const block = `${start}\n${source}\n${end}`
if (html.includes(start)) {
  const before = html.indexOf(start)
  const after = html.indexOf(end, before) + end.length
  html = html.slice(0, before) + block + html.slice(after)
} else {
  html = html.replace(
    'function openImageDb() {',
    `${block}\n\nfunction openImageDb() {`,
  )
}
const archive = (
  await readFile(
    new URL('../src/storage/workspace-archive.js', import.meta.url),
    'utf8',
  )
)
  .replaceAll('export function ', 'function ')
  .trim()
const library = await readFile(
  new URL('../node_modules/fflate/umd/index.js', import.meta.url),
  'utf8',
)
const archiveBlock =
  '// BEGIN SHARED WORKSPACE ARCHIVE\n' +
  library.trim() +
  '\n' +
  archive +
  '\n// END SHARED WORKSPACE ARCHIVE'
const archiveStart = html.indexOf('// BEGIN SHARED WORKSPACE ARCHIVE')
if (archiveStart >= 0)
  html =
    html.slice(0, archiveStart) +
    archiveBlock +
    html.slice(
      html.indexOf('// END SHARED WORKSPACE ARCHIVE', archiveStart) +
        '// END SHARED WORKSPACE ARCHIVE'.length,
    )
else
  html = html.replace(
    '// BEGIN SHARED IMAGE STORAGE',
    () => archiveBlock + '\n\n// BEGIN SHARED IMAGE STORAGE',
  )
const grid = (
  await readFile(
    new URL('../src/utils/virtual-grid.js', import.meta.url),
    'utf8',
  )
)
  .replaceAll('export function ', 'function ')
  .trim()
const gridBlock =
  '// BEGIN SHARED VIRTUAL GRID\n' + grid + '\n// END SHARED VIRTUAL GRID'
const gridStart = html.indexOf('// BEGIN SHARED VIRTUAL GRID')
if (gridStart >= 0)
  html =
    html.slice(0, gridStart) +
    gridBlock +
    html.slice(
      html.indexOf('// END SHARED VIRTUAL GRID', gridStart) +
        '// END SHARED VIRTUAL GRID'.length,
    )
else
  html = html.replace(
    '// BEGIN SHARED IMAGE STORAGE',
    () => gridBlock + '\n\n// BEGIN SHARED IMAGE STORAGE',
  )
const native = (
  await readFile(new URL('../src/api/native-media.js', import.meta.url), 'utf8')
)
  .replaceAll('export function ', 'function ')
  .replaceAll('export async function ', 'async function ')
  .trim()
const nativeBlock =
  '// BEGIN SHARED NATIVE MEDIA\n' + native + '\n// END SHARED NATIVE MEDIA'
const nativeStart = html.indexOf('// BEGIN SHARED NATIVE MEDIA')
if (nativeStart >= 0)
  html =
    html.slice(0, nativeStart) +
    nativeBlock +
    html.slice(
      html.indexOf('// END SHARED NATIVE MEDIA', nativeStart) +
        '// END SHARED NATIVE MEDIA'.length,
    )
else
  html = html.replace(
    '// BEGIN SHARED IMAGE STORAGE',
    () => nativeBlock + '\n\n// BEGIN SHARED IMAGE STORAGE',
  )
const agent = (
  await readFile(new URL('../src/api/image-agent.js', import.meta.url), 'utf8')
)
  .replaceAll('export function ', 'function ')
  .replaceAll('export async function ', 'async function ')
  .trim()
const chatImages = (
  await readFile(new URL('../src/api/chat-images.js', import.meta.url), 'utf8')
).replaceAll('export async function ', 'async function ')
const chatFiles = (
  await readFile(new URL('../src/api/chat-files.js', import.meta.url), 'utf8')
)
  .replaceAll('export const ', 'const ')
  .replaceAll('export async function ', 'async function ')
const agentBlock =
  '// BEGIN SHARED IMAGE AGENT\n' +
  agent +
  '\n' +
  chatImages +
  '\n' +
  chatFiles +
  '\n// END SHARED IMAGE AGENT'
const agentStart = html.indexOf('// BEGIN SHARED IMAGE AGENT')
if (agentStart >= 0)
  html =
    html.slice(0, agentStart) +
    agentBlock +
    html.slice(
      html.indexOf('// END SHARED IMAGE AGENT', agentStart) +
        '// END SHARED IMAGE AGENT'.length,
    )
else
  html = html.replace(
    '// BEGIN SHARED IMAGE STORAGE',
    () => agentBlock + '\n\n// BEGIN SHARED IMAGE STORAGE',
  )
const theme = await readFile(
  new URL('../src/styles/theme.css', import.meta.url),
  'utf8',
)
html = html.replace(
  /\/\* BEGIN SHARED THEME \*\/[\s\S]*?\/\* END SHARED THEME \*\//,
  () =>
    '/* BEGIN SHARED THEME */\n' + theme.trim() + '\n/* END SHARED THEME */',
)
const markdown = await readFile(
  new URL('../src/utils/markdown-renderer.js', import.meta.url),
  'utf8',
)
const markdownLibrary = await readFile(
  new URL('../node_modules/marked/lib/marked.umd.js', import.meta.url),
  'utf8',
)
const purifierLibrary = await readFile(
  new URL('../node_modules/dompurify/dist/purify.min.js', import.meta.url),
  'utf8',
)
const sidebar = await readFile(
  new URL('../src/utils/sidebar-resize.js', import.meta.url),
  'utf8',
)
const chatUi =
  '// BEGIN SHARED CHAT UI\n' +
  markdownLibrary.replace(/<\/script/gi, '<\\/script') +
  '\n' +
  purifierLibrary.replace(/<\/script/gi, '<\\/script') +
  '\n' +
  markdown.replace('export function ', 'function ') +
  '\n' +
  'const renderMarkdown = createMarkdownRenderer(marked, DOMPurify);\n' +
  sidebar.replaceAll('export function ', 'function ') +
  '\n// END SHARED CHAT UI'
html = html.replace(
  /\/\/ BEGIN SHARED CHAT UI[\s\S]*?\/\/ END SHARED CHAT UI/,
  () => chatUi,
)
const chatStyles = await readFile(
  new URL('../src/styles/chat.css', import.meta.url),
  'utf8',
)
html = html.replace(
  /\/\* BEGIN SHARED CHAT STYLES \*\/[\s\S]*?\/\* END SHARED CHAT STYLES \*\//,
  () =>
    '/* BEGIN SHARED CHAT STYLES */\n' +
    chatStyles.trim() +
    '\n/* END SHARED CHAT STYLES */',
)
if (html !== (await readFile(htmlPath, 'utf8'))) await writeFile(htmlPath, html)

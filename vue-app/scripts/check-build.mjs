import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const files = await readdir(new URL('../dist/', import.meta.url), {
  recursive: true,
})
assert.deepEqual(files, ['index.html'], '生产产物必须只有 index.html')
const html = await readFile(new URL('../dist/index.html', import.meta.url))
const source = html.toString('utf8')
assert.doesNotMatch(source, /<script\b[^>]*\ssrc\s*=/i, '不能依赖外部脚本')
assert.doesNotMatch(
  source,
  /<link\b[^>]*rel=["'](?:stylesheet|modulepreload)["']/i,
  '不能依赖外部样式或模块',
)
assert.doesNotMatch(source, /cdn\.jsdelivr\.net/, '不能依赖 CDN')
assert.doesNotMatch(source, /sourceMappingURL=/, '不能携带 sourcemap')
const legacy = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
const storage = (await readFile(new URL('../src/storage/image-assets.js', import.meta.url), 'utf8'))
  .replace('export function createImageStorage', 'function createImageStorage')
  .trim()
assert.equal(
  legacy.split('// BEGIN SHARED IMAGE STORAGE\n')[1]?.split('\n// END SHARED IMAGE STORAGE')[0],
  storage,
  'HTML 和 Vue 必须使用相同的图片存储实现',
)
console.log(
  `Single HTML: ${(html.length / 1024).toFixed(1)} KiB, gzip ${(gzipSync(html).length / 1024).toFixed(1)} KiB, Brotli ${(brotliCompressSync(html).length / 1024).toFixed(1)} KiB`,
)

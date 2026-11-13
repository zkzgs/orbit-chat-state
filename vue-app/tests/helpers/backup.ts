import { unzipSync } from 'fflate'

// 测试中还原文件正文, 同时支持旧 JSON 和 ZIP 备份。
export function readBackup(buffer: Buffer) {
  if (buffer[0] !== 80 || buffer[1] !== 75) return JSON.parse(buffer.toString())
  const files = unzipSync(buffer)
  const payload = JSON.parse(Buffer.from(files['manifest.json']).toString())
  for (const image of payload.images || []) {
    if (!image.file) continue
    if (!files[image.file]) throw new Error('缺少图片: ' + image.file)
    image.src =
      'data:' +
      image.mimeType +
      ';base64,' +
      Buffer.from(files[image.file]).toString('base64')
    delete image.file
    delete image.mimeType
  }
  return payload
}

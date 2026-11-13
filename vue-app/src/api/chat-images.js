// 图片 ID 常驻文字历史, 是否携带图片内容由对话策略决定。
export async function chatImageContent(message, images, preview, readPreview) {
  let mention = 0
  const text = (message.content || '').replace(/@图(?:\d+|\?)/g, (token) => {
    const id = message.mentionImageIds?.[mention++]
    return id ? `[图片 ID: ${id}]` : token
  })
  if (!images.length) return text
  if (!preview)
    return `${text}${text ? '\n\n' : ''}${images.map((image) => `[图片 ID: ${image.id}]`).join('\n')}`
  const content = text ? [{ type: 'text', text }] : []
  for (const [index, image] of images.entries()) {
    content.push(
      { type: 'text', text: `[image ${index + 1}] 图片 ID: ${image.id}` },
      { type: 'image_url', image_url: { url: await readPreview(image.src) } },
    )
  }
  return content
}

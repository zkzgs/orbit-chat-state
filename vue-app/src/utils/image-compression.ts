export async function findImageCompressionCandidate(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
) {
  let low = 0.01
  let high = 1
  const highestQuality = await encode(high)
  if (highestQuality.type !== 'image/webp')
    throw new Error('当前浏览器不支持 WebP 压缩')
  if (highestQuality.size <= targetBytes)
    return { blob: highestQuality, quality: 1, targetReached: true }
  let candidateQuality = low
  let candidate = await encode(low)
  if (candidate.type !== 'image/webp')
    throw new Error('当前浏览器不支持 WebP 压缩')
  if (candidate.size <= targetBytes) {
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const quality = (low + high) / 2
      const blob = await encode(quality)
      if (blob.size <= targetBytes) {
        candidate = blob
        candidateQuality = quality
        low = quality
      } else high = quality
    }
  }
  return {
    blob: candidate,
    quality: Number(candidateQuality.toFixed(3)),
    targetReached: candidate.size <= targetBytes,
  }
}

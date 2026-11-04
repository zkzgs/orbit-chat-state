export function inputFiles(event: Event): File[] {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  return files
}
export function pastedImages(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith('image/'),
  )
}

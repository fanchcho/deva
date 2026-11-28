// Browser files have no server path. Send bytes through the existing attachment IPC.
export function encodeAttachment(file) {
  if (!file.data) return file
  const bytes = new Uint8Array(file.data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return { ...file, data: { base64: btoa(binary) } }
}

export function pickAttachments(upload) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    document.body.appendChild(input)
    input.addEventListener('cancel', () => { input.remove(); resolve([]) }, { once: true })
    input.addEventListener('change', async () => {
      try {
        const result = []
        for (const file of input.files ?? []) {
          result.push(await upload({
            name: file.name, mime: file.type, size: file.size,
            data: file.size <= 20 * 1024 * 1024 ? new Uint8Array(await file.arrayBuffer()) : null
          }))
        }
        resolve(result)
      } catch (error) { reject(error) }
      finally { input.remove() }
    }, { once: true })
    input.click()
  })
}

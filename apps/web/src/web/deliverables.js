export async function downloadDeliverable(args) {
  const [sessionId, toolUseId, index] = args
  const query = new URLSearchParams({ sessionId, toolUseId, index: String(index) })
  const response = await fetch('/api/deliverables/file?' + query)
  if (!response.ok) {
    const body = await response.json()
    throw Object.assign(new Error(body.error), { code: body.code })
  }
  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('content-disposition') ?? '')?.[1]
  link.download = encoded ? decodeURIComponent(encoded) : 'download'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  return { ok: true }
}

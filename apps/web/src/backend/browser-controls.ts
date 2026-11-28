import { ipcMain } from 'electron'
import { allPages } from '@deva/main/services/browser/pages'
import { uiState } from '@deva/main/services/browser/host'
import { assertInside } from '@deva/main/services/fs-guard'

type Input = { kind: string; x?: number; y?: number; deltaY?: number; key?: string; text?: string; path?: string }

function visiblePage(id: string) {
  const page = allPages().find(candidate => candidate.id === id)
  if (!page || page.wc.isDestroyed() || !uiState().tabs.some(tab => tab.id === id)) {
    throw new Error('WEB_BROWSER_TAB_UNAVAILABLE: browser tab is closed or hidden')
  }
  return page
}

export function registerWebBrowserIpc(): void {
  ipcMain.handle('browser:web-frame', async (_event, id: string) => {
    const page = visiblePage(id)
    const image = await page.wc.capturePage()
    return { image: image.toDataURL(), ...image.getSize() }
  })
  ipcMain.handle('browser:web-input', async (_event, id: string, input: Input) => {
    const page = visiblePage(id)
    const send = (method: string, params: Record<string, unknown>) => page.wc.debugger.sendCommand(method, params)
    if (input?.kind === 'click' || input?.kind === 'wheel') {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x! < 0 || input.y! < 0 || input.x! > 1440 || input.y! > 900) {
        throw new Error('WEB_BROWSER_INPUT_INVALID: coordinates outside viewport')
      }
      if (input.kind === 'click') {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: input.x, y: input.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: input.x, y: input.y, button: 'left', clickCount: 1 })
      } else {
        if (!Number.isFinite(input.deltaY)) throw new Error('WEB_BROWSER_INPUT_INVALID: invalid scroll')
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX: 0, deltaY: Math.max(-2000, Math.min(2000, input.deltaY!)) })
      }
    } else if (input?.kind === 'text' && typeof input.text === 'string' && input.text.length <= 100000) {
      await send('Input.insertText', { text: input.text })
    } else if (input?.kind === 'key' && ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(input.key ?? '')) {
      const key = input.key!
      const codes: Record<string, number> = { Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40 }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: codes[key] })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: codes[key] })
    } else if (input?.kind === 'file' && typeof input.path === 'string') {
      assertInside(input.path)
      const { result } = await send('Runtime.evaluate', { expression: 'document.activeElement instanceof HTMLInputElement && document.activeElement.type === "file" ? document.activeElement : null' })
      if (!result?.objectId) throw new Error('WEB_BROWSER_FILE_INPUT_REQUIRED: select a file input on the page first')
      try { await send('DOM.setFileInputFiles', { objectId: result.objectId, files: [input.path] }) }
      finally { await send('Runtime.releaseObject', { objectId: result.objectId }) }
    } else throw new Error('WEB_BROWSER_INPUT_UNSUPPORTED: unsupported input action')
    return { ok: true }
  })
}

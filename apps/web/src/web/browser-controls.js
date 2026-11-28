// A user-facing controller for the same CDP page the agent is using. This is
// product UI; tests exercise its DOM callbacks without launching a browser.
export function installBrowserControls(invoke, subscribe) {
  let dialog, image, tabs, notice, error, state, refreshTimer, refreshing = false
  const run = async (fn) => { try { error.textContent = ''; return await fn() } catch (e) { error.textContent = e.message; return null } }
  const selected = () => state?.tabs?.find(tab => tab.id === tabs.value)
  const input = (data) => selected() && run(() => invoke('browser:web-input', selected().id, data))
  const refresh = async () => {
    if (!dialog?.open || !selected() || refreshing) return
    refreshing = true
    try {
      const id = selected().id
      const frame = await run(() => invoke('browser:web-frame', id))
      if (frame && selected()?.id === id) image.src = frame.image
    } finally { refreshing = false }
  }
  const create = () => {
    dialog = document.createElement('dialog'); dialog.className = 'deva-browser'
    const bar = document.createElement('div'); bar.className = 'deva-browser__bar'
    tabs = document.createElement('select'); tabs.setAttribute('aria-label', '浏览器标签 / Browser tabs'); bar.append(tabs)
    const button = (label, action) => { const b = document.createElement('button'); b.textContent = label; b.type = 'button'; b.onclick = () => run(action); bar.append(b) }
    tabs.onchange = () => run(async () => { await invoke('browser:activate', tabs.value); await refresh() })
    for (const [label, what] of [['后退','back'],['前进','forward'],['刷新','reload']]) button(label, () => selected() && invoke('browser:nav', selected().id, what))
    button('关闭标签', () => selected() && invoke('browser:close-tab', selected().id))
    button('完成，继续', () => selected() && invoke('browser:handoff', selected().sessionId, 'done'))
    button('跳过', () => selected() && invoke('browser:handoff', selected().sessionId, 'skip'))
    button('收起', async () => { await invoke('browser:dock'); dialog.close(); clearInterval(refreshTimer) })
    notice = document.createElement('p'); error = document.createElement('p'); error.setAttribute('role', 'alert')
    image = document.createElement('img'); image.alt = '远端网页，点击后可输入 / Remote page'; image.tabIndex = 0
    const point = e => { const r = image.getBoundingClientRect(); return { x: Math.round((e.clientX-r.left)*1440/r.width), y: Math.round((e.clientY-r.top)*900/r.height) } }
    image.onclick = e => { image.focus(); void input({ kind: 'click', ...point(e) }) }
    image.onwheel = e => { e.preventDefault(); void input({ kind: 'wheel', ...point(e), deltaY: e.deltaY }) }
    image.onkeydown = e => { if (['Enter','Tab','Backspace','Delete','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); void input({ kind: 'key', key: e.key }) } }
    const entry = document.createElement('textarea'); entry.placeholder = '输入到网页当前焦点 / Text for focused field'
    button('输入文字', async () => { if (entry.value && await input({ kind: 'text', text: entry.value })) entry.value = '' })
    button('上传文件到网页', async () => { const files = await invoke('fs:pick-attachments'); if (files?.[0]?.path) await input({ kind: 'file', path: files[0].path }) })
    dialog.append(bar, notice, error, image, entry); document.body.append(dialog)
    dialog.oncancel = e => { e.preventDefault(); void run(async () => { await invoke('browser:dock'); dialog.close(); clearInterval(refreshTimer) }) }
  }
  const update = next => {
    state = next
    if (!state?.open) { dialog?.close(); clearInterval(refreshTimer); return }
    if (!dialog) create()
    tabs.replaceChildren(...state.tabs.map(tab => { const option = document.createElement('option'); option.value = tab.id; option.textContent = tab.title || tab.url || tab.id; return option }))
    tabs.value = state.active || state.tabs[0]?.id || ''
    notice.textContent = Object.values(state.handoff ?? {}).map(h => h.message).join('\n')
    if (!dialog.open) { dialog.showModal(); clearInterval(refreshTimer); refreshTimer = setInterval(() => void refresh(), 1000) }
    void refresh()
  }
  subscribe('browser:state', update)
  // Reloading during a handoff must recover the active page instead of waiting
  // for another state event.
  void invoke('browser:state').then(update).catch(e => console.error('[web-browser]', e))
}

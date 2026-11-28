export function installNotifications(invoke, subscribe) {
  subscribe('web:notification', payload => {
    const open = async () => {
      try { await invoke('web:notification-click', payload.id) }
      catch (error) { window.alert(error.message) }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notification = new Notification(payload.title, { body: payload.body, tag: payload.id })
        notification.onclick = () => { window.focus(); notification.close(); void open() }
        return
      } catch { /* In-app notification below remains available when native notifications fail. */ }
    }
    const item = document.createElement('div'); item.className = 'deva-web-notice'; item.setAttribute('role', 'status')
    const button = document.createElement('button'); button.textContent = `${payload.title}: ${payload.body}`
    button.onclick = () => { item.remove(); void open() }
    const close = document.createElement('button'); close.textContent = '关闭 / Dismiss'; close.onclick = () => item.remove()
    item.append(button, close)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && typeof Notification.requestPermission === 'function') {
      const enable = document.createElement('button'); enable.textContent = '启用系统通知 / Enable notifications'
      enable.onclick = async () => { try { await Notification.requestPermission(); enable.remove() } catch (error) { window.alert(error.message) } }
      item.append(enable)
    }
    document.body.append(item)
    setTimeout(() => item.remove(), 300000)
  })
}

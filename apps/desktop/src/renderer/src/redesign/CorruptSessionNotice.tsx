import { useEffect, useState } from 'react'
import { useChatActions } from '../store/chat'

export function CorruptSessionNotice(): React.JSX.Element | null {
  const [corrupt, setCorrupt] = useState<{ id: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const { selectSession } = useChatActions()
  useEffect(() => {
    const listener = (event: Event): void => { setCorrupt((event as CustomEvent).detail); setError('') }
    window.addEventListener('deva:corrupt-session', listener)
    return () => window.removeEventListener('deva:corrupt-session', listener)
  }, [])
  if (!corrupt) return null
  return <div role="alertdialog" aria-label="会话损坏，只读保护" style={{ position: 'fixed', inset: '20% 15%', zIndex: 10000, background: 'var(--bg, white)', padding: 24, overflow: 'auto' }}>
    <strong>会话损坏，原件已进入只读保护</strong>
    <p>{corrupt.message}</p>
    <p>恢复会先逐字节复制原件，再创建空白分支。不会覆盖、移动或删除原件。</p>
    <button onClick={() => setCorrupt(null)}>保留原件</button>
    <button onClick={() => { void window.deva.chat.recoverCorrupt(corrupt.id, true).then(id => { setCorrupt(null); selectSession(id) }).catch(e => setError(String(e))) }}>另存副本并新建分支</button>
    {error && <p role="alert">{error}</p>}
  </div>
}

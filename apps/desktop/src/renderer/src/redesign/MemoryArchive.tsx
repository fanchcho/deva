import { useEffect, useState } from 'react'
import type { MemoryEntry, MemoryScopeArg } from '../../../preload'
import { useI18n } from '../i18n/i18n'
import { fill } from './memory-editor'

/** 三层共用遗忘区；独立于现有记忆详情编辑器，不改动 type/title/body 编辑行为。 */
export function MemoryArchive({ scope, onChanged }: { scope?: MemoryScopeArg; onChanged: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [check, setCheck] = useState<{ stale: string[]; similar: string[][] } | null>(null)
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(scope)
  useEffect(() => {
    let active = true
    setEntries([])
    setError('')
    setCheck(null)
    const reload = (): void => {
      void window.deva.memory.archive(key ? JSON.parse(key) : undefined)
        .then(rows => { if (active) setEntries(rows) })
        .catch(e => { if (active) setError(String(e)) })
    }
    reload()
    const off = window.deva.chat.onEvent(p => { if (p.event.type === 'done') reload() })
    return () => { active = false; off() }
  }, [key])
  const restore = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.deva.memory.restore(id, scope)
      if (!result.ok) throw new Error(result.error)
      setEntries(await window.deva.memory.archive(scope))
      onChanged()
      setError('')
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const inspect = async (): Promise<void> => {
    try { setCheck(await window.deva.memory.check(scope)); setError('') }
    catch (e) { setError(String(e)) }
  }
  const q = query.trim().toLowerCase()
  const visible = entries.filter(e => !q || (e.id + '\n' + e.title + '\n' + e.body).toLowerCase().includes(q))
  return <details className="cf-field">
    <summary>{t('cf.profile.arcTitle')} ({entries.length}){typeof scope === 'string' ? ` · ${scope}` : ''}</summary>
    {error && <div role="alert">{error}</div>}
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('cf.profile.arcSearch')} aria-label={t('cf.profile.arcSearch')} />
    <button type="button" className="cf-btn" onClick={() => void inspect()}>{t('cf.profile.arcCheck')}</button>
    {check && <p role="status">{fill(t('cf.profile.arcCheckResult'), { stale: check.stale.length, similar: check.similar.length })}</p>}
    {visible.map(e => <div key={e.id}>
      <strong>{e.title}</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{e.body}</pre>
      <button type="button" className="cf-btn" disabled={busy} onClick={() => void restore(e.id)}>{t('cf.profile.arcRestore')}</button>
    </div>)}
  </details>
}

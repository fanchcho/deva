import { useState } from 'react'
import { useI18n } from '../i18n/i18n'
import { MemoryArchive } from './MemoryArchive'
import { MemoryDetail } from './MemoryDetail'
import { useMemoryList } from './memory-editor'

/** 当前工作区的活动记忆与遗忘区，沿用三层记忆详情编辑协议。 */
export function ProjectMemory({ root }: { root: string }): React.JSX.Element {
  const { t } = useI18n()
  const list = useMemoryList(root)
  const [openId, setOpenId] = useState<string | null>(null)
  const entry = list.mem?.entries.find(e => e.id === openId)
  return <details className="cf-field">
    <summary>{root}</summary>
    <MemoryArchive scope={root} onChanged={list.apply} />
    {list.mem?.entries.map(e => <button key={e.id} type="button" className="cf-convrow" onClick={() => setOpenId(e.id)}>
      <span className="cf-convrow__title">{e.title}</span>
    </button>)}
    {entry && <div role="dialog" aria-label={t('cf.profile.memDetail')}>
      <MemoryDetail key={entry.id} entry={entry} scope={root} onClose={() => setOpenId(null)} onChanged={list.apply} />
    </div>}
  </details>
}

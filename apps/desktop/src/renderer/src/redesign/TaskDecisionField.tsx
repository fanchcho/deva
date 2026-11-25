import { DEFAULT_DECISION_THRESHOLD } from '../../../shared/task-decision'
import { useI18n } from '../i18n/i18n'

export function TaskDecisionField({ enabled, providerId, threshold, providers, onEnabled, onProvider, onThreshold }: {
  enabled: boolean
  providerId: string
  threshold: string
  providers: { id: string; name: string; threshold?: number }[]
  onEnabled: (enabled: boolean) => void
  onProvider: (id: string) => void
  onThreshold: (threshold: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const selected = providers.find((provider) => provider.id === providerId)
  return (
    <div className="cf-field">
      <label className="cf-field__label">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />{' '}
        {t('tasks.decisionEnable')}
      </label>
      {enabled && (
        <>
          <div className="cf-schedprev">{t('tasks.decisionHint')}</div>
          <label className="cf-field__label">
            {t('tasks.decisionProvider')}
            <select className="cf-input" value={providerId} onChange={(e) => onProvider(e.target.value)}>
              <option value="" disabled>{t('tasks.decisionPick')}</option>
              {providerId && !selected && <option value={providerId} disabled>{providerId}</option>}
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {!selected && <div role="status" className="cf-schedprev is-invalid">{t('tasks.decisionUnavailable')}</div>}
          <label className="cf-field__label">
            {t('tasks.decisionThreshold')}
            <input className="cf-input" type="number" min={0} max={1} step="any" value={threshold}
              placeholder={String(selected?.threshold ?? DEFAULT_DECISION_THRESHOLD)}
              onChange={(e) => onThreshold(e.target.value)} />
          </label>
        </>
      )}
    </div>
  )
}

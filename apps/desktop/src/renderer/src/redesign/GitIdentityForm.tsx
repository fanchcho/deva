import { useState } from 'react'
import { useI18n } from '../i18n/i18n'
import { useToast } from '../components/ToastProvider'

/** 提交失败后的身份恢复：保存并读回成功才通知提交框解锁重试。 */
export function GitIdentityForm({
  root, onSaved, onCancel
}: {
  root: string
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [global, setGlobal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    if (busy || !name.trim() || !email.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await window.deva.git.setConfig(root, name.trim(), email.trim(), global)
      if (!result.ok) throw new Error(result.message || t('cf.git.identitySaveFailed'))
      toast.show({ variant: 'success', message: t('cf.git.identitySaved') })
      onSaved()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast.show({ variant: 'error', title: t('cf.git.identitySaveFailed'), message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="ext-field" disabled={busy}>
      <legend>{t('cf.git.identityTitle')}</legend>
      <p className="ext-field__note">{t('cf.git.identityHint')}</p>
      <label className="ext-field__label">
        user.name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label className="ext-field__label">
        user.email
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
      </label>
      <label className="ext-field__label">
        {t('cf.git.identityScope')}
        <select className="input" value={global ? 'global' : 'local'} onChange={(e) => setGlobal(e.target.value === 'global')}>
          <option value="local">{t('cf.git.identityLocal')}</option>
          <option value="global">{t('cf.git.identityGlobal')}</option>
        </select>
      </label>
      {error && <p role="alert" className="ext-field__note ext-field__note--warn">{error}</p>}
      <div className="cf-commit__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>{t('cf.cancel')}</button>
        <button type="button" className="btn btn--primary" disabled={busy || !name.trim() || !email.trim()} onClick={() => void save()}>
          {t('cf.git.identitySave')}
        </button>
      </div>
    </fieldset>
  )
}

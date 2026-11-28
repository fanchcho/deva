import { useCallback, useEffect, useRef, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { useI18n } from '../i18n/i18n'
import { useDialog } from '../components/DialogProvider'
import { useToast } from '../components/ToastProvider'
type GeneralView = Awaited<ReturnType<typeof window.deva.general.getState>>

/**
 * 安卓入站通道详情（设计 §3.2/§3.5 的桌面面）：状态 + 一次性配对码（二维码）+ 已配对设备。
 * 状态每 5s 轮询（配对码生成/作废/吊销后立即刷新）；通道启停挂在主进程生命周期，此处只读。
 */
export function GeneralDetail({ pairRequest }: { pairRequest: number }): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useDialog()
  const toast = useToast()
  // pairRequest 只消费一次:+ 菜单触发的自动出码不能在每次重挂载时都顶掉旧码
  const handledPairRequest = useRef(-1)
  // 配对码活着时的引用:离开详情(unmount)即作废——看不到的码不该继续有效(与 IM BotDetail 同口径)
  const livePair = useRef(false)
  const [st, setSt] = useState<GeneralView | null>(null)
  const [pair, setPair] = useState<
    Extract<Awaited<ReturnType<typeof window.deva.general.pairCode>>, { ok: true }> | null
  >(null)
  const [, setTick] = useState(0)

  const reload = useCallback((): void => {
    void window.deva.general.getState().then(setSt)
  }, [])

  // general:changed 推送到达时 reload(getChannelServerState 全量刷新)
  useEffect(() => {
    reload()
    return window.deva.general.onChanged(() => reload())
  }, [reload])

  // 配对码倒计时；过期自动收起
  useEffect(() => {
    if (!pair) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [pair])
  useEffect(() => {
    livePair.current = pair !== null
  }, [pair])
  // 离开详情:未过期的配对码立即作废——看不到的码不该继续有效(与 IM BotDetail 同口径)
  useEffect(
    () => () => {
      if (livePair.current) void window.deva.general.pairCancel()
    },
    []
  )
  const makeCode = useCallback((): void => {
    void window.deva.general.pairCode().then((r) => {
      if (r.ok) {
        setPair(r)
        livePair.current = true
      } else {
        setPair(null)
        livePair.current = false
        toast.show({ variant: 'error', message: r.error || t('bots.failed') })
      }
    })
  }, [t, toast])

  // 「+」菜单选通用设备:导航到此详情并自动出码(每个 tick 只消费一次)
  useEffect(() => {
    if (pairRequest > 0 && handledPairRequest.current !== pairRequest) {
      handledPairRequest.current = pairRequest
      makeCode()
    }
  }, [pairRequest, makeCode])
  const left = pair ? Math.max(0, Math.ceil((pair.expiresAt - Date.now()) / 1000)) : 0
  useEffect(() => {
    if (pair && left <= 0) {
      livePair.current = false
      setPair(null)
    }
  }, [pair, left])


  const revoke = async (id: string, name: string): Promise<void> => {
    const ok = await dialog.confirm({
      title: t('bots.general.revoke'),
      message: t('bots.general.revokeConfirm').replace('{name}', name || id),
      confirmText: t('bots.general.revoke'),
      variant: 'danger'
    })
    if (!ok) return
    await window.deva.general.removeDevice(id)
    reload()
  }

  const state = st?.state ?? 'off'

  return (
    <>
      <div className="bots-detail__head">
        <span className="bots-logo">
          <Smartphone size={22} />
        </span>
        <div className="bots-detail__title">
          <span className="bots-detail__name">{t('bots.general.title')}</span>
          <span className={`bots-detail__state is-${state}`}>
            <span className={`bots-dot bots-dot--${state}`} />
            {t(`bots.state.${state}`)}
            {st && (
              <>
                <span className="bots-detail__sep">·</span>
                {t('bots.general.listen').replace('{host}', st.host).replace('{port}', String(st.port))}
                <span className="bots-detail__sep">·</span>
                {st.devices.length}
              </>
            )}
          </span>
        </div>
      </div>
      {st?.state === 'error' && st.error && <div className="mcp-error">{st.error}</div>}

      <div className="bots-card">
        <div className="bots-card__row">
          <div className="bots-card__label">
            {t('bots.general.enable')}
            <span className="bots-card__hint">{t('bots.general.enableHint')}</span>
          </div>
          <button
            className={`cf-switch${(st?.enabled ?? true) ? ' is-on' : ''}`}
            aria-pressed={st?.enabled ?? true}
            title={t('bots.general.enable')}
            onClick={() => {
              const next = !(st?.enabled ?? true)
              void window.deva.general.setEnabled(next)
              setSt((s0) => (s0 ? { ...s0, enabled: next, state: next ? 'connecting' : 'off' } : s0))
            }}
          >
            <span className="cf-switch__dot" />
          </button>
        </div>
        <p className="bots-card__hint">{t('bots.general.hint')}</p>
        <div className="bots-card__row">
          <div className="bots-card__label">
            {t('bots.general.pair')}
            <span className="bots-card__hint">{t('bots.general.pairHint')}</span>
          </div>
          <button className="bots-btn" onClick={makeCode}>
            {t('bots.general.pair')}
          </button>
        </div>
        {pair && (
          <div className="bots-pair">
            <img src={pair.qr} alt="QR" width={140} height={140} />
            <code className="bots-pair__code">{pair.code}</code>
            <div className="bots-pair__meta">
              <span className="bots-card__hint">
                {(pair.hosts ?? [pair.host]).map((h) => `${h}:${pair.port}`).join(' / ')}
              </span>
              <span className="bots-card__hint">{t('bots.general.pairExpires').replace('{s}', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)}</span>
              <button className="ext-linkbtn" onClick={makeCode}>
                {t('bots.general.pairRegen')}
              </button>
              <button
                className="ext-linkbtn"
                onClick={() => {
                  livePair.current = false
                  setPair(null)
                  void window.deva.general.pairCancel()
                }}
              >
                {t('bots.general.pairCancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bots-card">
        <div className="bots-card__row">
          <div className="bots-card__label">
            {t('bots.general.hostMode')}
            <span className="bots-card__hint">{t('bots.general.hostModeHint')}</span>
          </div>
          <div className="cf-seg">
            {(['0.0.0.0', '127.0.0.1'] as const).map((h) => (
              <button
                key={h}
                className={`cf-seg__opt${st?.host === h ? ' is-on' : ''}`}
                onClick={() => {
                  void window.deva.general.setHost(h)
                  // 立即反馈：重启监听约一两秒，5s 轮询会把真实状态带回来
                  setSt((s0) => (s0 ? { ...s0, host: h, state: s0.state === 'connected' ? 'connecting' : s0.state } : s0))
                }}
              >
                {t(h === '0.0.0.0' ? 'bots.general.lan' : 'bots.general.localOnly')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bots-card">
        <div className="bots-card__label">
          {t('bots.general.devices')}
          {st && <span className="bots-tag">{st.devices.length}</span>}
        </div>
        {!st || st.devices.length === 0 ? (
          <p className="bots-card__empty">{t('bots.general.devicesEmpty')}</p>
        ) : (
          st.devices.map((d) => (
            <div key={d.id} className="bots-user">
              <span className="bots-user__id">{d.name || d.id}</span>
              {d.online && <span className="bots-tag">{t('bots.general.online')}</span>}
              <span className="bots-user__at">{new Date(d.pairedAt).toLocaleString()}</span>
              {d.lastSeenAt > 0 && (
                <span className="bots-user__at">
                  {t('bots.general.lastSeen').replace('{t}', new Date(d.lastSeenAt).toLocaleString())}
                </span>
              )}
              <button className="ext-linkbtn" onClick={() => void revoke(d.id, d.name)}>
                {t('bots.general.revoke')}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="bots-warn">{t('bots.general.plain')}</p>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/i18n'
import { useChatActions, useChatState } from '../store/chat'
import { formatTokens } from '../../../shared/context'
import { fill } from './shell-common'

export function ContextChip(): React.JSX.Element | null {
  const { t } = useI18n()
  const { contextUsage } = useChatState()
  const { setCompactRatio, refreshContextUsage } = useChatActions()
  const [open, setOpen] = useState(false)
  // 打开面板就重拉一次快照：压缩记录 / 提示词构成只在回合收尾时推送，回合还在跑时缓存里那份是压缩前的旧值。
  useEffect(() => {
    if (open) refreshContextUsage()
  }, [open, refreshContextUsage])
  if (!contextUsage || contextUsage.window <= 0) return null
  const {
    used,
    window,
    compactAt,
    cacheRead,
    cacheWrite,
    ratio,
    actualRatio,
    minRatio,
    maxRatio,
    defaultRatio,
    compactLog,
    parts,
    windowUncapped
  } = contextUsage
  const pct = Math.min(100, (used / window) * 100)
  // 压缩线进度：越接近 100% 越快被自动压缩（与压缩判定的口径一致）。不截断——越过线时报 104%
  // 才看得懂「已经超了、正在压」，截成 100% 反而像阈值设成了 100%。只用于悬浮提示与分级。
  const compactPct = compactAt > 0 ? (used / compactAt) * 100 : 0
  // 缓存命中率：命中 / (命中 + 写入 + 未命中)。总输入 used 含命中量，故未命中 = used - 命中 - 写入。
  const miss = Math.max(0, used - cacheRead - cacheWrite)
  const denom = cacheRead + cacheWrite + miss
  const hitPct = denom > 0 ? (cacheRead / denom) * 100 : 0
  // 分级：占用过半转黄、越过压缩线转红（底色跟着变，一眼能看出快压缩了）。
  const level: 'ok' | 'warn' | 'hot' = compactPct >= 100 ? 'hot' : pct >= 50 ? 'warn' : 'ok'
  const fmt = (n: number): string => formatTokens(Math.round(n))
  const title = fill(t('cf.ctx.tip'), {
    used: fmt(used),
    window: fmt(window),
    pct: `${pct.toFixed(1)}%`,
    compact: fmt(compactAt),
    compactPct: `${compactPct.toFixed(0)}%`,
    read: fmt(cacheRead),
    write: fmt(cacheWrite),
    hit: denom > 0 ? `${hitPct.toFixed(1)}%` : '—'
  })
  // 比例只能让压缩提前：越过 actualRatio 的部分不生效（会撞「输入+输出超窗口」），面板如实标注。
  const clamped = ratio > actualRatio + 0.0005
  return (
    <div className="model-pick">
      <button
        type="button"
        className={`cf-usage is-${level}${open ? ' is-open' : ''}`}
        title={title}
        aria-label={`${t('cf.ctx.usage')} ${Math.round(pct)}% · ${t('cf.ctx.cache')} ${hitPct.toFixed(1)}%`}
        onClick={() => setOpen((v) => !v)}
      >
        <ContextRing pct={pct} />
        <span className="cf-usage__pct">{Math.round(pct)}%</span>
        <span className="cf-usage__sep">·</span>
        <span className="cf-usage__cache">
          <span className="cf-usage__icon">⚡</span>
          {denom > 0 ? `${hitPct.toFixed(1)}%` : '—'}
        </span>
      </button>
      {open && (
        <>
          <div className="model-pick__backdrop" onClick={() => setOpen(false)} />
          <div className="model-pick__menu cf-usage-panel" role="dialog">
            <div className="cf-usage-panel__head">{t('cf.ctx.panelTitle')}</div>
            <div className="cf-usage-panel__row">
              <span>{t('cf.ctx.panelRatio')}</span>
              <strong>{Math.round(ratio * 100)}%</strong>
            </div>
            <input
              type="range"
              className="cf-usage-panel__range"
              min={Math.round(minRatio * 100)}
              max={Math.round(maxRatio * 100)}
              value={Math.round(ratio * 100)}
              onChange={(e) => setCompactRatio(Number(e.target.value) / 100)}
            />
            <div className="cf-usage-panel__scale">
              <span>{Math.round(minRatio * 100)}%</span>
              <span>{t('cf.ctx.panelDefault')} {Math.round(defaultRatio * 100)}%</span>
              <span>{Math.round(maxRatio * 100)}%</span>
            </div>
            {/* 实际生效比例（受输出预留收窄）与两档读数 */}
            <div className={`cf-usage-panel__note${clamped ? ' is-warn' : ''}`}>
              {fill(t(clamped ? 'cf.ctx.panelClamped' : 'cf.ctx.panelActual'), {
                n: `${Math.round(actualRatio * 100)}%`,
                at: fmt(compactAt)
              })}
            </div>
            <div className="cf-usage-panel__stats">
              <span>{t('cf.ctx.panelUsed')} {fmt(used)} / {fmt(window)}</span>
            </div>
            {windowUncapped !== undefined && windowUncapped > window && (
              /* 生效窗口比模型标称小：这是 AUTO_WINDOW_CAP 有意为之（标称 1M 的模型几十万 token
                 就开始退化），不是算错。讲清楚，并指出去哪里改成 1M。 */
              <div className="cf-usage-panel__cap">
                {fill(t('cf.ctx.windowCapped'), {
                  cap: fmt(window),
                  full: fmt(windowUncapped)
                })}
              </div>
            )}
            {parts && (
              /* 提示词构成：provider 只回报总输入，分项是本地估算按真实总量等比缩放——
                 三项之和恒等于上面的「当前占用」，不会出现分项加不上的怪账。 */
              <div className="cf-usage-panel__parts">
                <div className="cf-usage-panel__part">
                  <span className="cf-usage-panel__dot is-sys" />
                  <span>{t('cf.ctx.partSystem')}</span>
                  <span className="cf-usage-panel__num">~{fmt(parts.system)}</span>
                </div>
                <div className="cf-usage-panel__part">
                  <span className="cf-usage-panel__dot is-tool" />
                  <span>{t('cf.ctx.partTools')}</span>
                  <span className="cf-usage-panel__num">~{fmt(parts.tools)}</span>
                </div>
                <div className="cf-usage-panel__part">
                  <span className="cf-usage-panel__dot is-msg" />
                  <span>{t('cf.ctx.partMessages')}</span>
                  <span className="cf-usage-panel__num">~{fmt(parts.messages)}</span>
                </div>
              </div>
            )}
            <div className="cf-usage-panel__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCompactRatio(null)}>
                {t('cf.ctx.panelReset')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                {t('cf.ctx.panelClose')}
              </button>
            </div>
            <div className="cf-usage-panel__head cf-usage-panel__head--log">{t('cf.ctx.panelLogTitle')}</div>
            {compactLog.length === 0 ? (
              <div className="cf-usage-panel__empty">{t('cf.ctx.panelLogEmpty')}</div>
            ) : (
              <div className="cf-usage-panel__log">
                {[...compactLog]
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((e, i) => (
                    <div key={`${e.at}-${i}`} className={`cf-usage-panel__entry${e.error ? ' is-error' : ''}`}>
                      <span className="cf-usage-panel__when">
                        {new Date(e.at).toLocaleString('zh-CN', { hour12: false }).slice(5)} ·{' '}
                        {e.turn > 0 ? t('cf.ctx.turnN').replace('{n}', String(e.turn)) : '—'} · {e.scope === 'manual' ? '/compact' : 'auto'}
                      </span>
                      {e.error ? (
                        <span className="cf-usage-panel__err">{e.error}</span>
                      ) : (
                        <span className="cf-usage-panel__nums">
                          {e.before === null ? '?' : fmt(e.before)} → {e.after === null ? t('cf.ctx.pending') : fmt(e.after)}
                          {' · '}
                          {t('cf.ctx.foldedN').replace('{n}', String(e.folded))}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** 环形进度（占用的百分比）：一段圆弧，不依赖额外 CSS 动画，深浅按分级取色（见 .cf-usage.is-*）。 */
function ContextRing({ pct }: { pct: number }): React.JSX.Element {
  const r = 6.5
  const c = 2 * Math.PI * r
  const on = Math.min(c, (pct / 100) * c)
  return (
    <svg className="cf-usage__ring" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={8} cy={8} r={r} className="cf-usage__ring-bg" />
      <circle
        cx={8}
        cy={8}
        r={r}
        className="cf-usage__ring-fg"
        strokeDasharray={`${on} ${c}`}
        strokeDashoffset={0}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

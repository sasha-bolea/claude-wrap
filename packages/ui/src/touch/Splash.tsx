import type { Connection, StoreState } from '@claude-wrap/client'
import { t } from '../i18n.ts'
import type { AppCapability } from '../appUpdate.ts'

// Launch screen until the server answers: the same mark as the iOS splash, then the connection state — connecting,
// unreachable (Riprova; the app also connects by itself when the line is back), or refused.
export function Splash({ connection, state, app }: { connection: Connection; state: StoreState; app?: AppCapability }) {
  const refused = state.error ?? (state.status === 'incompatible' ? { code: 'incompatible_protocol', message: '' } : undefined)
  const unreachable = !refused && state.status === 'offline'
  const bad = Boolean(refused) || unreachable
  const text = refused ? t('connectionFailed', { code: refused.code, message: refused.message }) : unreachable ? t('serverUnreachable') : t('connectingServer')
  return (
    <section className="screen splash" aria-label={t('splashLabel')}>
      <div className="splash-main">
        <div className="hero-mark big" aria-hidden="true">
          cw
        </div>
        <strong className="splash-name">claude-wrap</strong>
        <p className={`splash-state${bad ? ' bad' : ''}`} role="status">
          {!bad && (
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          <span>{text}</span>
        </p>
        {unreachable && (
          <div className="splash-actions">
            <button className="button primary block" onClick={() => connection.reconnectNow()}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>
      <p className="splash-foot">{unreachable ? t('unreachableHint') : app ? t('appVersionShort', { version: app.version }) : ''}</p>
    </section>
  )
}

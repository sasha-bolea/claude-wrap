import { useEffect, useState } from 'react'
import type { Connection, StoreState } from '@athome/client'
import { t } from '../i18n.ts'
import type { AppCapability } from '../appUpdate.ts'

// How long the launch screen stays blank while connecting, so it looks like the iOS launch image's continuation.
const BLANK_MS = 1000

// Launch screen until the server answers: the iOS launch image's flat grey with nothing on it; only when connecting
// takes over a second does the connecting text appear. Unreachable (Riprova; the app also connects by itself when the
// line is back) and refused show at once.
export function Splash({ connection, state, app }: { connection: Connection; state: StoreState; app?: AppCapability }) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), BLANK_MS)
    return () => clearTimeout(timer)
  }, [])
  const refused = state.error ?? (state.status === 'incompatible' ? { code: 'incompatible_protocol', message: '' } : undefined)
  const unreachable = !refused && state.status === 'offline'
  const bad = Boolean(refused) || unreachable
  const text = refused ? t('connectionFailed', { code: refused.code, message: refused.message }) : unreachable ? t('serverUnreachable') : t('connectingServer')
  const shown = bad || late
  return (
    <section className="screen splash" aria-label={t('splashLabel')}>
      <div className="splash-main">
        <p className="splash-state" role="status">
          {shown && !bad && (
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {shown && <span>{text}</span>}
        </p>
        {unreachable && (
          <div className="splash-actions">
            <button className="button primary block" onClick={() => connection.reconnectNow()}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>
      <p className="splash-foot">{!shown ? '' : unreachable ? t('unreachableHint') : app ? t('appVersionShort', { version: app.version }) : ''}</p>
    </section>
  )
}

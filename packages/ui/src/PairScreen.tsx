import { useState } from 'react'
import { t } from './i18n.ts'

type PairScreenProps = {
  // Running as the installed app (iOS: Safari and the Home-screen app keep separate storage).
  installed: boolean
  // Code taken from a #pair= link, if the page was opened with one.
  initialCode?: string
  // Why the previous pairing ended (revoked device), if it did.
  notice?: string
  // Exchanges the code for a device token; rejects with a message to show.
  onPair: (code: string) => Promise<void>
}

// Accepts a pasted pairing link or a bare code.
export function codeFromInput(input: string): string {
  const trimmed = input.trim()
  return /#pair=([\w-]+)/.exec(trimmed)?.[1] ?? trimmed
}

// First screen of an unpaired PWA (touch layout). In Safari it explains how to install first (pairing there would
// pair Safari, not the app); in the installed app it takes the link or code from `claude-wrap pair` or another device.
export function PairScreen({ installed, initialCode, notice, onPair }: PairScreenProps) {
  const [input, setInput] = useState(initialCode ?? '')
  const [error, setError] = useState(notice)
  const [busy, setBusy] = useState(false)
  const [anyway, setAnyway] = useState(false)
  const pair = () => {
    setBusy(true)
    setError(undefined)
    onPair(codeFromInput(input))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(false))
  }
  const safari = !installed && !anyway
  return (
    <div className="device">
      <section className="screen" aria-label={t('pairLabel')}>
        <div className="scroll">
          <div className="pad">
            <div className="hero-mark" aria-hidden="true">
              @~
            </div>
            {safari ? (
              <>
                <h1 className="hero-title">{t('pairInstallTitle')}</h1>
                <p className="muted flat">{t('pairInstallBody')}</p>
                <ol className="steps">
                  <li>{t('pairStepShare')}</li>
                  <li>{t('pairStepAdd')}</li>
                  <li>{t('pairStepOpen')}</li>
                </ol>
                <p className="muted flat">{t('pairSafariNote')}</p>
                <button className="button block" onClick={() => setAnyway(true)}>
                  {t('pairInBrowser')}
                </button>
              </>
            ) : (
              <>
                <h1 className="hero-title">{t('pairTitle')}</h1>
                <p className="muted flat">{t('pairBody')}</p>
                <label className="label" htmlFor="pair-code">
                  {t('pairField')}
                </label>
                <input className="field" id="pair-code" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={t('pairPlaceholder')} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && input.trim() && !busy && pair()} />
                {error && (
                  <p className="error-text" role="alert">
                    {error}
                  </p>
                )}
                <button className="button primary block" disabled={busy || !input.trim()} onClick={pair}>
                  {t('pairButton')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

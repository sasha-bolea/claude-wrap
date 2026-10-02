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

// First screen of an unpaired PWA. In Safari it explains how to install first (pairing there would pair Safari,
// not the app); in the installed app it takes the link or code from `claude-wrap pair` or another device.
export function PairScreen({ installed, initialCode, notice, onPair }: PairScreenProps) {
  const [input, setInput] = useState(initialCode ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [anyway, setAnyway] = useState(false)
  const pair = () => {
    setBusy(true)
    setError(undefined)
    onPair(codeFromInput(input)).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))).finally(() => setBusy(false))
  }

  if (!installed && !anyway) {
    return (
      <main className="pair">
        <div className="pair-mark" aria-hidden="true">cw</div>
        <h1>{t('pairInstallTitle')}</h1>
        <p className="muted">{t('pairInstallBody')}</p>
        <ol className="pair-steps">
          <li>{t('pairStepShare')}</li>
          <li>{t('pairStepAdd')}</li>
          <li>{t('pairStepOpen')}</li>
        </ol>
        <p className="muted">{t('pairSafariNote')}</p>
        <button className="button" onClick={() => setAnyway(true)}>{t('pairInBrowser')}</button>
      </main>
    )
  }
  return (
    <main className="pair">
      <div className="pair-mark" aria-hidden="true">cw</div>
      <h1>{t('pairTitle')}</h1>
      <p className="muted">{t('pairBody')}</p>
      {notice && <p className="pair-error" role="alert">{notice}</p>}
      <label className="label" htmlFor="pair-code">{t('pairField')}</label>
      <input className="field" id="pair-code" autoComplete="off" autoCapitalize="off" spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} />
      {error && <p className="pair-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy || !input.trim()} onClick={pair}>{t('pairButton')}</button>
    </main>
  )
}

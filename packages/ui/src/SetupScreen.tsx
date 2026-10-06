import { useEffect, useState } from 'react'
import type { Palette } from '@athome/protocol'
import { t } from './i18n.ts'
import { Swatches } from './touch/PalettesScreen.tsx'

type SetupScreenProps = {
  // iPhone: the Safari steps; elsewhere the browser's install menu.
  ios: boolean
  // The palette already chosen (the address carries it after a reload).
  initial?: string
  // The backend's palettes and when the code expires; rejects when the code is used or expired.
  load: () => Promise<{ palettes: Palette[]; expiresAt: number }>
  // A palette was chosen: the host shows it and carries it into the installed app.
  onPick: (palette: Palette) => void
}

// The page the "install the app" link opens in the browser, before pairing: the palette the installed app will start
// with (its icon takes the main colour), then how to add the app to the Home screen. The pairing code stays unused
// here: the installed app spends it at its first start.
export function SetupScreen({ ios, initial, load, onPick }: SetupScreenProps) {
  const [offer, setOffer] = useState<{ palettes: Palette[]; expiresAt: number }>()
  const [gone, setGone] = useState(false)
  const [picked, setPicked] = useState(initial)
  useEffect(() => void load().then(setOffer, () => setGone(true)), [load])
  const pick = (palette: Palette) => {
    setPicked(palette.paletteId)
    onPick(palette)
  }
  const until = offer && new Date(offer.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="device">
      <section className="screen" aria-label={t('setupTitle')}>
        <div className="scroll">
          <div className="pad">
            <div className="hero-mark" aria-hidden="true">
              @~
            </div>
            <h1 className="hero-title">{t('setupTitle')}</h1>
            {gone ? (
              <p className="error-text" role="alert">
                {t('setupCodeGone')}
              </p>
            ) : (
              <>
                <p className="label">{t('setupPaletteLabel')}</p>
                <ul className="list" role="radiogroup" aria-label={t('setupPaletteLabel')}>
                  {offer?.palettes.map((palette) => (
                    <li key={palette.paletteId} className={`row end-pad${picked === palette.paletteId ? ' current' : ''}`}>
                      <button className="row-main" role="radio" aria-checked={picked === palette.paletteId} onClick={() => pick(palette)}>
                        <span className="row-title">{palette.name}</span>
                        <Swatches colors={palette.colors} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted flat">{t('setupPaletteHint')}</p>
                <p className="label">{t('setupStepsLabel')}</p>
                <ol className="steps">
                  {ios ? (
                    <>
                      <li>{t('pairStepShare')}</li>
                      <li>{t('pairStepAdd')}</li>
                    </>
                  ) : (
                    <li>{t('setupStepMenu')}</li>
                  )}
                  <li>{t('setupStepOpen')}</li>
                </ol>
                {until && <p className="muted flat">{t('setupExpires', { until })}</p>}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

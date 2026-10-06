import { useEffect, useState, useSyncExternalStore } from 'react'
import { PALETTE_COLORS, type Palette, type PaletteColors } from '@athome/protocol'
import { t } from '../i18n.ts'
import { activePaletteId, applyPalette, currentColors, readActivePalette, setActivePalette, subscribeActivePalette } from '../palette.ts'
import { useTouch } from './context.tsx'
import { Icon } from './icons.tsx'
import { IconButton, Title } from './parts.tsx'

const HEX = /^#[0-9a-f]{6}$/i

// The 6 colours of a palette as small round swatches (decoration: the name says which palette it is).
function Swatches({ colors }: { colors: PaletteColors }) {
  return (
    <span className="swatches" aria-hidden="true">
      {PALETTE_COLORS.map((key) => (
        <svg key={key} className="swatch" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill={colors[key]} />
        </svg>
      ))}
    </span>
  )
}

// Settings → Palette: the theme's colours or one of the backend's saved palettes, on this device; each palette opens
// in the editor; Nuova palette starts from the colours on screen now.
export function PalettesScreen() {
  const { state, back, go } = useTouch()
  const active = useSyncExternalStore(subscribeActivePalette, activePaletteId)
  const pick = (palette?: Palette) => setActivePalette(palette && { paletteId: palette.paletteId, colors: palette.colors })
  return (
    <section className="screen" aria-label={t('palettes')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t('palettes')} />
      </header>
      <div className="scroll">
        <div className="pad">
          <ul className="list" role="radiogroup" aria-label={t('palettes')}>
            <li className={`row end-pad${active ? '' : ' current'}`}>
              <button className="row-main" role="radio" aria-checked={!active} onClick={() => pick()}>
                <span className="row-title">{t('paletteTheme')}</span>
                <span className="row-sub">{t('paletteThemeHint')}</span>
              </button>
            </li>
            {state.palettes.map((palette) => (
              <li key={palette.paletteId} className={`row${active === palette.paletteId ? ' current' : ''}`}>
                <button className="row-main" role="radio" aria-checked={active === palette.paletteId} onClick={() => pick(palette)}>
                  <span className="row-title">{palette.name}</span>
                  <Swatches colors={palette.colors} />
                </button>
                <IconButton icon="more" label={t('paletteEdit', { name: palette.name })} onClick={() => go({ name: 'palette', paletteId: palette.paletteId })} />
              </li>
            ))}
          </ul>
          {state.palettes.length === 0 && <p className="muted flat">{t('palettesEmpty')}</p>}
        </div>
      </div>
      <div className="sticky-actions">
        <button className="button primary block" onClick={() => go({ name: 'palette' })}>
          <Icon name="plus" />
          {t('paletteNew')}
        </button>
      </div>
    </section>
  )
}

// One colour of the editor: the system colour picker and its #rrggbb, typed by hand if wanted.
function ColorRow({ name, value, onChange }: { name: keyof PaletteColors; value: string; onChange: (color: string) => void }) {
  const [typed, setTyped] = useState(value)
  useEffect(() => setTyped(value), [value])
  const type = (text: string) => {
    setTyped(text)
    const hex = text.startsWith('#') ? text : `#${text}`
    if (HEX.test(hex)) onChange(hex.toLowerCase())
  }
  return (
    <li className="row color-row">
      <span className="row-title plain">{t(`color_${name}`)}</span>
      <input className="field mono color-hex" aria-label={t('colorHex', { name: t(`color_${name}`) })} value={typed} maxLength={7} spellCheck={false} autoCapitalize="off" onChange={(event) => type(event.target.value)} onBlur={() => setTyped(value)} />
      <input type="color" className="color-pick" aria-label={t(`color_${name}`)} value={value} onChange={(event) => onChange(event.target.value)} />
    </li>
  )
}

// A palette's editor (paletteId absent: a new one, from the colours on screen now): its name and its 6 colours,
// shown on the whole app while they change. Salva keeps it on the backend and turns it on here; leaving without
// saving gives back the colours there were. Elimina (a saved one) after a confirmation.
export function PaletteScreen({ paletteId }: { paletteId?: string }) {
  const { state, connection, back, openSheet, closeSheet, toast, fail } = useTouch()
  const saved = state.palettes.find((palette) => palette.paletteId === paletteId)
  const [name, setName] = useState(saved?.name ?? '')
  const [colors, setColors] = useState<PaletteColors>(() => saved?.colors ?? currentColors())
  useEffect(() => applyPalette(colors), [colors])
  // Leaving: the colours of the palette on this device again (the saved one if Salva turned this one on).
  useEffect(() => () => applyPalette(readActivePalette()?.colors), [])

  const save = () =>
    connection.request('palettes.save', { paletteId, name: name.trim(), colors }).then(({ palette }) => {
      setActivePalette({ paletteId: palette.paletteId, colors: palette.colors })
      toast(t('paletteSaved', { name: palette.name }))
      back()
    }, fail)
  const remove = () =>
    openSheet({
      title: t('paletteDeleteTitle', { name: saved?.name ?? '' }),
      body: (
        <>
          <p className="muted flat">{t('paletteDeleteBody')}</p>
          <div className="two-buttons">
            <button className="button" onClick={closeSheet}>
              {t('cancel')}
            </button>
            <button
              className="button danger"
              onClick={() =>
                connection.request('palettes.delete', { paletteId: paletteId! }).then(() => {
                  if (readActivePalette()?.paletteId === paletteId) setActivePalette()
                  closeSheet()
                  toast(t('paletteDeleted'))
                  back()
                }, fail)
              }
            >
              {t('delete')}
            </button>
          </div>
        </>
      )
    })
  return (
    <section className="screen" aria-label={saved?.name ?? t('paletteNew')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={saved?.name ?? t('paletteNew')} />
        {saved && <IconButton icon="trash" label={t('paletteDelete')} onClick={remove} />}
      </header>
      <div className="scroll">
        <div className="pad">
          <input className="field" aria-label={t('paletteName')} placeholder={t('paletteName')} maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
          <ul className="list">
            {PALETTE_COLORS.map((key) => (
              <ColorRow key={key} name={key} value={colors[key]} onChange={(color) => setColors((current) => ({ ...current, [key]: color }))} />
            ))}
          </ul>
          <p className="muted flat">{t('paletteHint')}</p>
        </div>
      </div>
      <div className="sticky-actions">
        <button className="button primary block" disabled={!name.trim()} onClick={() => void save()}>
          {t('save')}
        </button>
      </div>
    </section>
  )
}

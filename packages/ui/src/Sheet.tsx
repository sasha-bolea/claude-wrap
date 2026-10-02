import { useEffect, useRef, type ReactNode } from 'react'

type SheetProps = { label: string; onClose: () => void; children: ReactNode }

// Bottom sheet (mobile): a dialog over a scrim, opened by a user action. Tapping the scrim or Esc closes it.
// Focus goes to its first field, or to the sheet itself — never to a button (design rule 6).
export function Sheet({ label, onClose, children }: SheetProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const sheet = ref.current
    ;(sheet?.querySelector<HTMLElement>('input, textarea') ?? sheet)?.focus()
  }, [])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onClose()
        }}
      >
        <h2 className="sheet-title">{label}</h2>
        {children}
      </section>
    </>
  )
}

import { useEffect } from 'react'
import { t } from './i18n.ts'

// One entry of a suggestion list: what it shows and what picking it inserts.
export type Option = { key: string; label: string; detail?: string; value: string }

type SuggestionsProps = {
  id: string
  label: string
  options: Option[]
  active: number
  onPick: (option: Option) => void
}

// Listbox shown above the composer (commands, files, previous messages). The textarea keeps the focus and points
// at the active option with aria-activedescendant; a click picks without taking the focus away.
export function Suggestions({ id, label, options, active, onPick }: SuggestionsProps) {
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, active])
  return (
    <ul className="suggestions" role="listbox" id={id} aria-label={label}>
      {options.length === 0 && (
        <li className="suggestion muted" role="option" aria-selected={false} aria-disabled>
          {t('noMatches')}
        </li>
      )}
      {options.map((option, index) => (
        <li
          key={option.key}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className={`suggestion${index === active ? ' active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(option)
          }}
        >
          <span className="suggestion-label">{option.label}</span>
          {option.detail && <span className="suggestion-detail">{option.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

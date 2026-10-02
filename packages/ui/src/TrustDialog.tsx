import { useEffect, useRef } from 'react'
import type { CommandResult } from '@claude-wrap/protocol'
import { isFocusFree } from './focus.ts'
import { t } from './i18n.ts'
import type { MessageKey } from './i18n/en.ts'

export type TrustCheck = CommandResult<'trust.check'>

type TrustDialogProps = { cwd: string; check: TrustCheck; onAccept: () => void; onCancel?: () => void }

// One category of project configuration; hidden when empty.
function ConfigList({ label, entries }: { label: MessageKey; entries: string[] }) {
  if (!entries.length) return null
  return (
    <div>
      <strong>{t(label)}</strong>
      <ul className="config-list">
        {entries.map((entry) => (
          <li key={entry}>
            <code>{entry}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Folder trust dialog, in place of the CLI's (SDK sessions never show it): lists what the project would load
// and run. It may appear by itself (a restored tab), so it takes the focus on the panel, never on "Yes", and
// only if the focus is free (design-system rule 6).
export function TrustDialog({ cwd, check, onAccept, onCancel }: TrustDialogProps) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (isFocusFree()) panel.current?.focus()
  }, [])
  const { hooks, mcp, permissions, risks, files } = check.config
  const empty = !hooks.length && !mcp.length && !permissions.length && !risks.length && !files.length
  return (
    <section ref={panel} className="request-panel" tabIndex={-1} aria-label={t('trustRegion')}>
      <h3>{t('trustTitle')}</h3>
      <p className="muted">{cwd}</p>
      <p>{t('trustBody')}</p>
      <ConfigList label="trustRisks" entries={risks} />
      <ConfigList label="trustHooks" entries={hooks} />
      <ConfigList label="trustMcp" entries={mcp} />
      <ConfigList label="trustPermissions" entries={permissions} />
      <ConfigList label="trustFiles" entries={files} />
      {empty && <p className="muted">{t('trustNothing')}</p>}
      <p className="muted">{check.scope.sessionOnly ? t('trustScopeSession', { path: check.scope.path }) : t('trustScopeSaved', { path: check.scope.path })}</p>
      <div className="actions">
        <button className="button primary" onClick={onAccept}>
          {t('trustYes')}
        </button>
        {onCancel && (
          <button className="button" onClick={onCancel}>
            {t('cancel')}
          </button>
        )}
      </div>
    </section>
  )
}

import { useState, type FormEvent } from 'react'
import { PERMISSION_BEHAVIORS, SETTINGS_DESTINATIONS, type PermissionBehavior, type PermissionRule, type Permissions, type SettingsDestination } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch } from './context.tsx'
import { InspectBody, InspectTop, errorText, useInspect, useReloadOnTop, useSessionSub } from './inspect.tsx'
import { IconButton } from './parts.tsx'
import { DESTINATION_FILES, destinationOf, sourceLabelKey, visibleText } from './permissions.ts'

type PermissionsTab = PermissionBehavior | 'folders'

// The tabs of the panel, in the CLI's order.
const TABS: PermissionsTab[] = [...PERMISSION_BEHAVIORS, 'folders']
// What the rule field shows as an example.
const RULE_PLACEHOLDER = 'Bash(npm run test:*)'

// A source as the user reads it: its label, or the raw text for a source the app does not know.
function sourceLabel(source: string): string {
  const key = sourceLabelKey(source)
  return key ? t(key) : visibleText(source)
}

// What something removed is and where it is stored: a rule or a folder, with the settings file it leaves.
type Removal = { kind: 'rule'; behavior: PermissionBehavior; rule: string; destination: SettingsDestination } | { kind: 'folder'; path: string; destination: SettingsDestination }

// Runs a request from a sheet: busy while it runs, a failure kept as text in the sheet, on success reads the list again
// and closes the sheet with a toast.
// Parameters: the request to send and the toast text. Returns the error, the busy flag and the runner.
function useSheetRequest(reload: () => void) {
  const { closeSheet, toast } = useTouch()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = (request: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(undefined)
    request().then(
      () => {
        reload()
        closeSheet()
        toast(done)
      },
      (failure: unknown) => (setError(errorText(failure)), setBusy(false))
    )
  }
  return { error, busy, run }
}

// The failure of a sheet, as an alert under its fields.
function SheetError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p className="error-text selectable" role="alert">
      {error}
    </p>
  )
}

// Confirmation of a removal: what goes (in mono, as plain text) and the file it leaves; Cancel or Remove.
function RemoveSheet({ tabId, removal, reload }: { tabId: string; removal: Removal; reload: () => void }) {
  const { connection, closeSheet } = useTouch()
  const { error, busy, run } = useSheetRequest(reload)
  const remove = () =>
    run(
      () =>
        removal.kind === 'rule'
          ? connection.request('tab.permissionRule', { tabId, op: 'remove', behavior: removal.behavior, rule: removal.rule, destination: removal.destination })
          : connection.request('tab.permissionDirectory', { tabId, op: 'remove', path: removal.path, destination: removal.destination }),
      t('permRemoved')
    )
  return (
    <>
      <p className="mono-line selectable flat">{visibleText(removal.kind === 'rule' ? removal.rule : removal.path)}</p>
      <p className="muted flat">{t('permRemoveFrom', { file: DESTINATION_FILES[removal.destination] })}</p>
      <SheetError error={error} />
      <div className="two-buttons">
        <button className="button" onClick={closeSheet}>
          {t('cancel')}
        </button>
        <button className="button danger" disabled={busy} onClick={remove}>
          {t('permRemove')}
        </button>
      </div>
    </>
  )
}

// Where a new rule or folder is saved: the three settings files as a radio menu, each with its path.
function DestinationPicker({ value, onPick }: { value: SettingsDestination; onPick: (destination: SettingsDestination) => void }) {
  return (
    <>
      <p className="label">{t('permSaveIn')}</p>
      <ul className="menu" role="radiogroup" aria-label={t('permSaveIn')}>
        {SETTINGS_DESTINATIONS.map((destination) => (
          <li key={destination}>
            <button type="button" role="radio" aria-checked={destination === value} onClick={() => onPick(destination)}>
              <span className="two-lines">
                <span>{t(`permDest_${destination}`)}</span>
                <small className="muted mono-line">{DESTINATION_FILES[destination]}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// The sheet that adds a rule (for the current tab's behavior) or a folder: its text field, a short help and the
// destination; the CLI's refusal stays in the sheet.
function AddSheet({ tabId, tab, reload }: { tabId: string; tab: PermissionsTab; reload: () => void }) {
  const { connection } = useTouch()
  const { error, busy, run } = useSheetRequest(reload)
  const [text, setText] = useState('')
  const [destination, setDestination] = useState<SettingsDestination>('localSettings')
  const value = text.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value || busy) return
    run(
      () => (tab === 'folders' ? connection.request('tab.permissionDirectory', { tabId, op: 'add', path: value, destination }) : connection.request('tab.permissionRule', { tabId, op: 'add', behavior: tab, rule: value, destination })),
      t('permAdded')
    )
  }
  return (
    <form className="group" onSubmit={submit}>
      <input
        className="field mono"
        aria-label={t(tab === 'folders' ? 'permFolderLabel' : 'permRuleLabel')}
        placeholder={tab === 'folders' ? '~/projects/other' : RULE_PLACEHOLDER}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="muted flat">{t(tab === 'folders' ? 'permFolderHelp' : 'permRuleHelp')}</p>
      <DestinationPicker value={destination} onPick={setDestination} />
      <SheetError error={error} />
      <button className="button primary block" type="submit" disabled={busy || !value}>
        {t('permAdd')}
      </button>
    </form>
  )
}

// The CLI's plain-language reading of a rule: prefix, the emphasised part in bold, suffix; all React text.
function Reading({ description }: { description: NonNullable<PermissionRule['description']> }) {
  return (
    <span className="row-sub wrap selectable">
      {visibleText(description.prefix)}
      {description.emphasis && <strong>{visibleText(description.emphasis)}</strong>}
      {description.suffix && visibleText(description.suffix)}
    </span>
  )
}

// One rule: its text in mono, the CLI's reading under it, where it comes from; a bin when it is saved in a settings
// file (the CLI's policy, flags and session approvals cannot be removed here). Muted when it does not take effect.
function RuleRow({ rule, onRemove }: { rule: PermissionRule; onRemove: () => void }) {
  const source = [sourceLabel(rule.source), rule.notInEffect ? t('permNotInEffect') : undefined].filter(Boolean).join(' · ')
  return (
    <li className={`row${rule.notInEffect ? ' dim' : ''}`}>
      <span className="row-main">
        <span className="row-title plain mono-line selectable">{visibleText(rule.rule)}</span>
        {rule.description && <Reading description={rule.description} />}
        <span className="row-sub">{source}</span>
      </span>
      {rule.editable === 'persistent' && destinationOf(rule.source) && <IconButton icon="trash" label={t('permRemoveRuleLabel', { rule: visibleText(rule.rule) })} onClick={onRemove} />}
    </li>
  )
}

// The folders: the session's own first (never removable), then the extra ones with where each comes from.
function FolderRows({ data, onRemove }: { data: Permissions; onRemove: (path: string, destination: SettingsDestination) => void }) {
  const extras = data.directories.filter((directory) => directory.path !== data.cwd)
  return (
    <>
      <ul className="list">
        <li className="row">
          <span className="row-main">
            <span className="row-title plain mono-line selectable">{visibleText(data.cwd)}</span>
            <span className="row-sub">{t('permSessionFolder')}</span>
          </span>
        </li>
        {extras.map((directory) => {
          const destination = destinationOf(directory.source)
          return (
            <li key={`${directory.source}:${directory.path}`} className="row">
              <span className="row-main">
                <span className="row-title plain mono-line selectable">{visibleText(directory.path)}</span>
                <span className="row-sub">{sourceLabel(directory.source)}</span>
              </span>
              {destination && <IconButton icon="trash" label={t('permRemoveFolderLabel', { path: visibleText(directory.path) })} onClick={() => onRemove(directory.path, destination)} />}
            </li>
          )
        })}
      </ul>
      {!extras.length && <p className="empty-line">{t('permNoneFolders')}</p>}
    </>
  )
}

// The tab strip: Allow, Ask, Deny and Folders as one radio group, each with its count.
function TabStrip({ tab, counts, onPick }: { tab: PermissionsTab; counts: Record<PermissionsTab, number>; onPick: (tab: PermissionsTab) => void }) {
  return (
    <div className="segmented effort cols-4" role="radiogroup" aria-label={t('permTabsLabel')}>
      {TABS.map((name) => (
        <label key={name}>
          <input type="radio" name="permissions-tab" value={name} checked={tab === name} onChange={() => onPick(name)} />
          <span>
            {t(`permTab_${name}`)} {counts[name]}
          </span>
        </label>
      ))}
    </div>
  )
}

// The session's permissions, as /permissions: the allow, ask and deny rules with where each comes from and the folders
// Claude may work in. Saved rules and folders can be removed (after asking) and added, into one of the three settings
// files.
export function PermissionsScreen({ tabId }: { tabId: string }) {
  const { connection, openSheet } = useTouch()
  const [tab, setTab] = useState<PermissionsTab>('allow')
  const inspect = useInspect(() => connection.request('tab.permissions', { tabId }), [connection, tabId])
  useReloadOnTop(inspect)
  const sessionSub = useSessionSub(tabId)
  const { reload } = inspect
  const confirmRemoval = (removal: Removal) => openSheet({ title: t(removal.kind === 'rule' ? 'permRemoveTitle' : 'permRemoveFolderTitle'), body: <RemoveSheet tabId={tabId} removal={removal} reload={reload} /> })
  return (
    <section className="screen" aria-label={t('later_permissions')}>
      <InspectTop title={t('later_permissions')} sub={inspect.data ? <span className="mono-line">{visibleText(inspect.data.cwd)}</span> : sessionSub} onRefresh={reload} />
      <InspectBody inspect={inspect}>
        {(data) => {
          const counts = { allow: 0, ask: 0, deny: 0, folders: 1 + data.directories.filter((directory) => directory.path !== data.cwd).length } satisfies Record<PermissionsTab, number>
          for (const rule of data.rules) counts[rule.behavior]++
          const rules = tab === 'folders' ? [] : data.rules.filter((rule) => rule.behavior === tab)
          return (
            <>
              {data.managedOnly && (
                <div className="card compact" role="status">
                  <span className="selectable">{t('permManagedOnly')}</span>
                </div>
              )}
              <TabStrip tab={tab} counts={counts} onPick={setTab} />
              <p className="muted flat">{t('permHint')}</p>
              {tab === 'folders' ? (
                <FolderRows data={data} onRemove={(path, destination) => confirmRemoval({ kind: 'folder', path, destination })} />
              ) : rules.length ? (
                <ul className="list">
                  {rules.map((rule) => (
                    <RuleRow key={`${rule.source}:${rule.behavior}:${rule.rule}`} rule={rule} onRemove={() => confirmRemoval({ kind: 'rule', behavior: rule.behavior, rule: rule.rule, destination: destinationOf(rule.source)! })} />
                  ))}
                </ul>
              ) : (
                <p className="empty-line">{t(`permNone_${tab}`)}</p>
              )}
              <button className="button block" onClick={() => openSheet({ title: tab === 'folders' ? t('permAddFolder') : t('permAddRuleTitle', { kind: t(`permTab_${tab}`) }), field: true, body: <AddSheet tabId={tabId} tab={tab} reload={reload} /> })}>
                {t(tab === 'folders' ? 'permAddFolder' : 'permAddRule')}
              </button>
            </>
          )
        }}
      </InspectBody>
    </section>
  )
}

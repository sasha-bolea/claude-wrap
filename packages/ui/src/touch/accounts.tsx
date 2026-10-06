import { useState } from 'react'
import type { Account, TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch, type LiveState } from './context.tsx'
import { IconButton } from './parts.tsx'
import { when } from './sessions.tsx'

// Claude accounts in the touch layout: Claude Code's own login of the backend, plus accounts added with a token made
// by `claude setup-token`. One of them is the account of every session; switching keeps the conversations.

// The name of an account (undefined = Claude Code's own login).
export function accountName(state: LiveState, accountId: string | undefined): string {
  if (!accountId) return t('cliLogin')
  return state.accounts?.find((account) => account.accountId === accountId)?.name ?? t('cliLogin')
}

// Settings → Account Claude: the login and the added accounts; a tap makes one the account of every session; ⋯
// removes an added one; "Aggiungi account" takes a name and a token.
export function AccountsGroup() {
  const { state, connection, openSheet, toast, fail } = useTouch()
  const accounts = state.accounts ?? []
  const setDefault = (accountId: string | undefined) =>
    connection.request('accounts.setDefault', { accountId }).then(() => toast(t('accountSwitched', { name: accountName(state, accountId) })), fail)
  const row = (accountId: string | undefined, name: string, sub: string, account?: Account) => (
    <li key={accountId ?? 'login'} className="row end-pad">
      <button className="row-main" aria-label={t('useForNewSessions', { name })} onClick={() => void setDefault(accountId)}>
        <span className="row-title">
          {name} {state.defaultAccount === accountId && <span className="chip">{t('defaultChip')}</span>}
        </span>
        <span className="row-sub">{sub}</span>
      </button>
      {account && <IconButton icon="more" label={t('accountActions', { name })} onClick={() => openSheet({ title: name, body: <AccountMenu account={account} /> })} />}
    </li>
  )
  return (
    <div className="group">
      <p className="label">{t('claudeAccounts')}</p>
      <ul className="list">
        {row(undefined, t('cliLogin'), t('cliLoginSub'))}
        {accounts.map((account) => row(account.accountId, account.name, t('addedOn', { when: when(account.addedAt) }), account))}
      </ul>
      <button className="button block" onClick={() => openSheet({ title: t('addAccount'), field: true, body: <AddAccountSheet /> })}>
        {t('addAccount')}
      </button>
    </div>
  )
}

// A new account: a name and the token made by `claude setup-token` (kept by the server, never shown again).
function AddAccountSheet() {
  const { connection, closeSheet, toast, fail } = useTouch()
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const ready = Boolean(name.trim() && token.trim())
  const add = () =>
    ready &&
    connection.request('accounts.add', { name: name.trim(), token: token.trim() }).then(() => {
      closeSheet()
      toast(t('accountAdded', { name: name.trim() }))
    }, fail)
  return (
    <>
      <label className="label" htmlFor="account-name">
        {t('accountName')}
      </label>
      <input className="field" id="account-name" placeholder={t('accountNamePlaceholder')} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      <label className="label" htmlFor="account-token">
        {t('accountToken')}
      </label>
      <input className="field mono" id="account-token" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="sk-ant-oat01-…" value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void add()} />
      <p className="muted flat">{t('accountTokenHint')}</p>
      <button className="button primary block" disabled={!ready} onClick={() => void add()}>
        {t('addAccount')}
      </button>
    </>
  )
}

// ⋯ of an added account: rename it, or remove it (after a confirmation).
function AccountMenu({ account }: { account: Account }) {
  const { connection, openSheet, closeSheets, toast, fail } = useTouch()
  const remove = () =>
    connection.request('accounts.remove', { accountId: account.accountId }).then(() => {
      closeSheets()
      toast(t('accountRemoved'))
    }, fail)
  return (
    <ul className="menu">
      <li>
        <button onClick={() => openSheet({ title: t('rename'), field: true, body: <RenameAccountSheet account={account} /> })}>{t('rename')}</button>
      </li>
      <li>
        <button
          className="danger"
          onClick={() =>
            openSheet({
              title: t('removeAccountTitle', { name: account.name }),
              body: (
                <>
                  <p className="flat">{t('removeAccountBody')}</p>
                  <button className="button danger block" onClick={() => void remove()}>
                    {t('removeAccount')}
                  </button>
                </>
              )
            })
          }
        >
          {t('removeAccount')}
        </button>
      </li>
    </ul>
  )
}

// A new name for an account (its token stays).
function RenameAccountSheet({ account }: { account: Account }) {
  const { connection, closeSheets, toast, fail } = useTouch()
  const [name, setName] = useState(account.name)
  const save = () =>
    name.trim() &&
    connection.request('accounts.rename', { accountId: account.accountId, name: name.trim() }).then(() => {
      closeSheets()
      toast(t('accountRenamed', { name: name.trim() }))
    }, fail)
  return (
    <>
      <input className="field" aria-label={t('accountName')} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void save()} />
      <button className="button primary block" disabled={!name.trim()} onClick={() => void save()}>
        {t('save')}
      </button>
    </>
  )
}

// The account (a session's menu): picking another switches every session, keeping the conversations.
export function AccountPickSheet({ tabId }: { tabId: string }) {
  const { state, connection, closeSheet, go, toast, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  if (!meta) return null
  const pick = (accountId: string | undefined) => {
    closeSheet()
    if (accountId === meta.account) return
    connection.request('tab.setAccount', { tabId, accountId }).then(() => toast(t('accountSwitched', { name: accountName(state, accountId) })), fail)
  }
  const options: { accountId?: string; name: string }[] = [{ name: t('cliLogin') }, ...(state.accounts ?? [])]
  return (
    <>
      <ul className="menu" role="radiogroup" aria-label={t('account')}>
        {options.map((option) => (
          <li key={option.accountId ?? 'login'}>
            <button role="radio" aria-checked={option.accountId === meta.account} onClick={() => pick(option.accountId)}>
              {option.name}
            </button>
          </li>
        ))}
      </ul>
      <button className="button block" onClick={() => go({ name: 'settings' })}>
        {t('addAnAccount')}
      </button>
    </>
  )
}

// Limits whose card was put away with Annulla (account and until when), on this device: every chat hides it.
const dismissedLimits = new Set<string>()

// In the chat while the session's account is at its usage limit: until when, a quiet switch to every other added
// account (for every session) or adding one, and Annulla, which puts the card away for that limit.
export function LimitCard({ meta }: { meta: TabMeta }) {
  const { state, connection, go, toast, fail } = useTouch()
  const [, setDismissed] = useState(0)
  const key = `${meta.account ?? ''}:${meta.limitedUntil}`
  if (!meta.limitedUntil || dismissedLimits.has(key)) return null
  const dismiss = () => {
    dismissedLimits.add(key)
    setDismissed((count) => count + 1)
  }
  const time = new Date(meta.limitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Only the added accounts are offered (Claude Code's own login is not, as Sasha asked); it stays in the account menu.
  const others = (state.accounts ?? []).filter((account) => account.accountId !== meta.account)
  const switchTo = (accountId: string | undefined) =>
    connection.request('tab.setAccount', { tabId: meta.tabId, accountId }).then(() => toast(t('accountSwitched', { name: accountName(state, accountId) })), fail)
  return (
    <div className="card" role="status">
      <span>{t('limitReached', { name: accountName(state, meta.account), time })}</span>
      <div className="card-actions">
        {others.length > 0 ? (
          others.map((account) => (
            <button key={account.accountId ?? 'login'} className="button quiet" onClick={() => void switchTo(account.accountId)}>
              {t('switchTo', { name: account.name })}
            </button>
          ))
        ) : (
          <button className="button quiet" onClick={() => go({ name: 'settings' })}>
            {t('addAnAccount')}
          </button>
        )}
        <button className="link-btn" onClick={dismiss}>
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}

// In the chat of a session Claude stopped mid-work (usage limit or account switch) once its account is free: "Continua"
// sends "continua" to every session stopped this way; "Non ora" only takes the cards away.
export function ContinueCard({ meta }: { meta: TabMeta }) {
  const { state, connection, fail } = useTouch()
  if (!meta.interrupted || meta.limitedUntil) return null
  const count = state.tabs.filter((tab) => tab.interrupted && !tab.limitedUntil).length
  const go = (text?: string) => connection.request('tabs.continue', text ? { text } : {}).catch(fail)
  return (
    <div className="card" role="status">
      <span>{count > 1 ? t('stoppedMany', { count: String(count) }) : t(meta.interrupted === 'limit' ? 'stoppedByLimit' : 'stoppedBySwitch')}</span>
      <div className="card-actions">
        <button className="button quiet" onClick={() => void go(t('continueText'))}>
          {count > 1 ? t('continueAll', { count: String(count) }) : t('continueOne')}
        </button>
        <button className="link-btn" onClick={() => void go()}>
          {t('notNow')}
        </button>
      </div>
    </div>
  )
}

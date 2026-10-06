import { randomUUID } from 'node:crypto'
import type { Account } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { JsonFile } from './jsonFile.ts'

type StoredAccount = Account & { token: string }
type AccountsData = { accounts: StoredAccount[]; defaultAccount?: string }

// A token made by `claude setup-token` (an OAuth token, sk-ant-oat…): checked when added, so a wrong paste is refused
// at once instead of failing at the next message.
const TOKEN = /^sk-ant-oat\d*-[\w-]{20,}$/

// The Claude accounts of the backend besides Claude Code's own login: a name and a token each, in
// <stateDir>/accounts.json (owner-only; the tokens never leave core), and the account of new sessions (undefined =
// the login). In memory only without a state folder (tests).
export class AccountStore {
  readonly loaded: Promise<void>
  private data: AccountsData = { accounts: [] }
  private readonly file?: JsonFile<AccountsData>
  private readonly changed: () => void
  private readonly readOnly: boolean

  // file: where they are saved; changed: called after every change (and once loaded) to tell the clients; readOnly:
  // the file belongs to another backend (the smokes): it is only read, changes stay in memory.
  constructor(file: string | undefined, changed: () => void, readOnly = false) {
    this.file = file ? new JsonFile<AccountsData>(file, 0o600) : undefined
    this.changed = changed
    this.readOnly = readOnly
    this.loaded = (this.file?.read() ?? Promise.resolve(undefined)).then((saved) => {
      if (!saved) return
      this.data = saved
      this.changed()
    })
  }

  // The accounts as clients see them: no tokens.
  list(): Account[] {
    return this.data.accounts.map(({ accountId, name, addedAt }) => ({ accountId, name, addedAt }))
  }

  get defaultAccount(): string | undefined {
    return this.data.defaultAccount
  }

  has(accountId: string): boolean {
    return this.data.accounts.some((account) => account.accountId === accountId)
  }

  // The token of an account; undefined for Claude Code's own login.
  async token(accountId: string | undefined): Promise<string | undefined> {
    await this.loaded
    return accountId ? this.data.accounts.find((account) => account.accountId === accountId)?.token : undefined
  }

  // Adds an account. Returns its id.
  async add(name: string, token: string): Promise<string> {
    await this.loaded
    if (!TOKEN.test(token)) throw new CoreError('invalid_args', 'not a token made by claude setup-token (sk-ant-oat…)')
    const accountId = randomUUID()
    this.data = { ...this.data, accounts: [...this.data.accounts, { accountId, name, addedAt: Date.now(), token }] }
    await this.save()
    return accountId
  }

  // Removes an account (the default goes back to the login if it was this one).
  async remove(accountId: string): Promise<void> {
    await this.loaded
    if (!this.has(accountId)) throw new CoreError('not_found', `no account ${accountId}`)
    const defaultAccount = this.data.defaultAccount === accountId ? undefined : this.data.defaultAccount
    this.data = { accounts: this.data.accounts.filter((account) => account.accountId !== accountId), ...(defaultAccount ? { defaultAccount } : {}) }
    await this.save()
  }

  // Gives an account a new name (its token stays).
  async rename(accountId: string, name: string): Promise<void> {
    await this.loaded
    if (!this.has(accountId)) throw new CoreError('not_found', `no account ${accountId}`)
    this.data = { ...this.data, accounts: this.data.accounts.map((account) => (account.accountId === accountId ? { ...account, name } : account)) }
    await this.save()
  }

  // The account of new sessions (undefined = the login).
  async setDefault(accountId: string | undefined): Promise<void> {
    await this.loaded
    if (accountId && !this.has(accountId)) throw new CoreError('not_found', `no account ${accountId}`)
    this.data = { accounts: this.data.accounts, ...(accountId ? { defaultAccount: accountId } : {}) }
    await this.save()
  }

  private async save(): Promise<void> {
    this.changed()
    if (!this.readOnly) await this.file?.save(this.data)
  }
}

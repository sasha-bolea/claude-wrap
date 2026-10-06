import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Connection } from '@athome/client'

// The app's state folder on this machine, as the server resolves it.
const stateDir = process.env.CLAUDE_WRAP_STATE_DIR ?? join(homedir(), '.local', 'state', 'claude-wrap')

// The account of the app session that launched this script (CLAUDE_CODE_SESSION_ID, looked up in the app's
// state.json, which holds account ids only); undefined outside an app session or for a session on Claude Code's login.
function launchingAccount(): string | undefined {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  const stateFile = join(stateDir, 'state.json')
  if (!sessionId || !existsSync(stateFile)) return undefined
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { tabs?: { sessionId?: string; account?: string }[] }
  return state.tabs?.find((tab) => tab.sessionId === sessionId)?.account
}

// For the real-CLI scripts: their sessions run on the same Claude account as the app session that launched them, not
// on Claude Code's own login (which may be at its usage limit). config: spread into createCore (the core reads the
// app's accounts read-only; the tokens stay in core); useAccount: call after each tab.create. Prints the account id,
// never a token.
export function appAccounts(): { config: { accountsFile?: string }; useAccount: (connection: Connection, tabId: string) => Promise<void> } {
  const accountsFile = join(stateDir, 'accounts.json')
  const account = existsSync(accountsFile) ? launchingAccount() : undefined
  console.log(account ? `smoke: the account of the launching session (${account})` : "smoke: Claude Code's own login")
  return {
    config: account ? { accountsFile } : {},
    useAccount: async (connection, tabId) => {
      if (account) await connection.request('tab.setAccount', { tabId, accountId: account })
    }
  }
}

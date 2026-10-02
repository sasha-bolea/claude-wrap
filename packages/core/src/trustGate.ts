import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { relative, isAbsolute } from 'node:path'
import type { CommandResult } from '@claude-wrap/protocol'
import { CoreError } from './errors.ts'
import type { StateStore } from './state.ts'
import { analyzeProject, findGitRoot, isTrusted, readCliProjects, tooBroad, trustScope } from './trust.ts'

// The trust gate of this backend: folders trusted for good (state.json) or for this run only (too broad to save).
export class TrustGate {
  private readonly store: StateStore
  private readonly home: string
  private readonly sessionOnly = new Set<string>()

  constructor(store: StateStore, home = homedir()) {
    this.store = store
    this.home = home
    // Too-broad entries saved by older versions would trust thousands of folders.
    store.data.trustedFolders = store.data.trustedFolders.filter((folder) => !tooBroad(folder, home))
  }

  // True if the folder is trusted here, for this run, or by the CLI (git-root boundary).
  async isTrusted(cwd: string): Promise<boolean> {
    return isTrusted(cwd, this.store.data.trustedFolders, await readCliProjects(), await findGitRoot(cwd), [...this.sessionOnly])
  }

  // Trust state, what the folder would load and run, and where an accepted trust would apply.
  async check(cwd: string): Promise<CommandResult<'trust.check'>> {
    const [trusted, config, scope] = await Promise.all([this.isTrusted(cwd), analyzeProject(cwd), this.scope(cwd)])
    return { trusted, config, scope }
  }

  // Accepts the folder: saved at its scope, or remembered for this run only when too broad.
  async grant(cwd: string): Promise<void> {
    const scope = await this.scope(cwd)
    if (scope.sessionOnly) this.sessionOnly.add(scope.path)
    else if (!this.store.data.trustedFolders.includes(scope.path)) await this.store.update((data) => data.trustedFolders.push(scope.path))
  }

  private async scope(cwd: string) {
    return trustScope(cwd, await findGitRoot(cwd), this.home)
  }
}

// The folder a session spawns in: it must exist; on Linux symlinks are resolved (roots are compared on the real
// path), on Windows the given spelling is kept (the CLI keys its stored sessions on it).
export async function canonicalFolder(cwd: string): Promise<string> {
  const info = await stat(cwd).catch(() => undefined)
  if (!info?.isDirectory()) throw new CoreError('not_found', `folder not found: ${cwd}`)
  return process.platform === 'win32' ? cwd : realpath(cwd)
}

// Throws outside_root unless the folder lies inside one of the allowed roots.
export function checkRoots(folder: string, roots: 'any' | string[]): void {
  if (roots === 'any') return
  const inside = roots.some((root) => {
    const path = relative(root, folder)
    return !path.startsWith('..') && !isAbsolute(path)
  })
  if (!inside) throw new CoreError('outside_root', `folder outside the allowed roots: ${folder}`)
}

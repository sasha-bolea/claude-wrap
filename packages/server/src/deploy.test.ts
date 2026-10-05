// Sub-phase A: deploy/install.sh and rollback.sh on Linux (skipped on Windows), with stub npm, npx and systemctl so
// nothing is built and no service is touched. User stories: a manual install goes live and installs the update timer;
// a timer run leaves the live commit alone, builds a new commit but switches to it only while no session is working,
// never retries a commit whose tests failed, never brings back a release I rolled back from, and does not fill the disk
// with old releases.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEPLOY = join(import.meta.dirname, '..', '..', '..', 'deploy')

describe.skipIf(process.platform === 'win32')('deploy/install.sh', () => {
  it('installs, then updates only when idle, never retries a failed commit, and keeps only the releases it needs', { timeout: 60_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-deploy-'))
    const at = (...parts: string[]) => join(root, ...parts)
    const log = at('log')
    // Stubs: npm and npx fail inside a release that contains FAIL; systemctl answers is-active from a file.
    mkdirSync(at('bin'))
    const stub = (name: string, body: string) => writeFileSync(at('bin', name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 })
    stub('npm', '[ ! -f FAIL ]')
    stub('npx', '[ ! -f FAIL ]')
    stub('systemctl', `case "$*" in *is-active*) [ -f "${at('active')}" ] ;; *) exit 0 ;; esac`)

    // The origin repository: the real deploy folder, one commit per version.
    const git = (...args: string[]) => spawnSync('git', ['-C', at('origin'), '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' })
    const commit = (message: string) => (git('add', '-A'), git('commit', '--quiet', '-m', message), git('rev-parse', 'HEAD').stdout.trim())
    mkdirSync(at('origin'))
    git('init', '--quiet', '-b', 'main')
    cpSync(DEPLOY, at('origin', 'deploy'), { recursive: true })
    const first = commit('first')

    const env = { ...process.env, HOME: at('home'), PATH: `${at('bin')}:${process.env.PATH}`, CLAUDE_WRAP_APP_DIR: at('app'), CLAUDE_WRAP_REPO_URL: at('origin') }
    const script = (name: string, ...args: string[]) => {
      writeFileSync(log, '')
      const result = spawnSync('bash', [join(DEPLOY, name), ...args], { env, encoding: 'utf8' })
      return { status: result.status, calls: readFileSync(log, 'utf8') }
    }
    const run = (...args: string[]) => script('install.sh', ...args)
    const current = () => readlinkSync(at('app', 'current'))
    const release = (sha: string) => at('app', 'releases', sha)
    const working = (count: number) => {
      mkdirSync(at('home', '.local', 'state', 'claude-wrap'), { recursive: true })
      writeFileSync(at('home', '.local', 'state', 'claude-wrap', 'activity.json'), JSON.stringify({ working: count }))
    }

    // Manual install: the first run only creates the environment file to fill in, the second goes live.
    expect(run().status).toBe(1)
    expect(existsSync(at('home', '.config', 'claude-wrap', 'env'))).toBe(true)
    let result = run()
    expect(result.status).toBe(0)
    expect(current()).toBe(release(first))
    expect(result.calls).toContain('systemctl --user restart claude-wrap')
    expect(result.calls).toContain('systemctl --user enable --now --quiet claude-wrap-update.timer')

    // Timer run with nothing new: nothing built, nothing restarted.
    writeFileSync(at('active'), '')
    result = run('main', '--when-idle')
    expect(result.status).toBe(0)
    expect(result.calls).toBe('')

    // A new commit while a session works: built and tested, not switched.
    writeFileSync(at('origin', 'change.txt'), 'second')
    const second = commit('second')
    working(1)
    result = run('main', '--when-idle')
    expect(result.status).toBe(0)
    expect(existsSync(join(release(second), '.ready'))).toBe(true)
    expect(current()).toBe(release(first))
    expect(result.calls).not.toContain('restart')

    // The next run with no session at work switches, without building again.
    working(0)
    result = run('main', '--when-idle')
    expect(result.status).toBe(0)
    expect(current()).toBe(release(second))
    expect(readlinkSync(at('app', 'previous'))).toBe(release(first))
    expect(result.calls).toContain('systemctl --user restart claude-wrap')
    expect(result.calls).not.toContain('npm ')

    // Rolled back from: the timer leaves the previous release running.
    result = script('rollback.sh')
    expect(result.status).toBe(0)
    expect(current()).toBe(release(first))
    result = run('main', '--when-idle')
    expect(result.status).toBe(0)
    expect(current()).toBe(release(first))
    expect(result.calls).toBe('')

    // A commit whose tests fail stays out, and the next runs leave it alone.
    writeFileSync(at('origin', 'FAIL'), '')
    const third = commit('third')
    result = run('main', '--when-idle')
    expect(result.status).toBe(1)
    expect(existsSync(join(release(third), '.failed'))).toBe(true)
    expect(current()).toBe(release(first))
    result = run('main', '--when-idle')
    expect(result.status).toBe(0)
    expect(result.calls).toBe('')

    // Each switch keeps only current, previous and the newest failed release (old ones fill the disk).
    const releases = () => readdirSync(at('app', 'releases')).sort()
    rmSync(at('origin', 'FAIL'))
    const fourth = commit('fourth')
    expect(run('main', '--when-idle').status).toBe(0)
    expect(current()).toBe(release(fourth))
    expect(releases()).toEqual([first, third, fourth].sort())
    writeFileSync(at('origin', 'change.txt'), 'fifth')
    const fifth = commit('fifth')
    expect(run('main', '--when-idle').status).toBe(0)
    expect(releases()).toEqual([third, fourth, fifth].sort())
  })
})

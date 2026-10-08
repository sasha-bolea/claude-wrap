import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { SETTINGS_DESTINATIONS, type PermissionBehavior, type SettingsDestination } from '@athome/protocol'
import { CoreError } from './errors.ts'

// Claude Code's settings files edited by the Permissions panel: permission rules and extra working folders, as
// /permissions saves them. A live CLI process does not watch these files (checked on 2.1.287): after a write the caller
// asks the live sessions to take them again (Tab.reloadSettings).

// A rule as /permissions accepts it: a tool name (letters, digits, _ - . * :), optionally followed by its content in
// parentheses; no control characters.
const RULE = /^[A-Za-z][\w*.:-]*(\([^\u0000-\u001f\u007f]*\))?$/

// Writes to one file wait for the previous one (two edits in a row must not read the same old content).
const queues = new Map<string, Promise<unknown>>()

// The settings file of a destination. cwd: the session's (canonical) folder; claudeDir: Claude Code's config folder.
export function settingsPath(destination: SettingsDestination, cwd: string, claudeDir: string): string {
  if (destination === 'userSettings') return join(claudeDir, 'settings.json')
  return join(cwd, '.claude', destination === 'projectSettings' ? 'settings.json' : 'settings.local.json')
}

// The trimmed rule, or invalid_args when the text is not a rule.
export function checkRule(text: string): string {
  const rule = text.trim()
  if (!RULE.test(rule)) throw new CoreError('invalid_args', `not a permission rule: ${rule.slice(0, 80)}`)
  return rule
}

// Reads a settings file as an object ({} when absent or empty). invalid_args when it is not a JSON object: a file
// Claude Code cannot read either is never overwritten.
export async function readSettings(file: string): Promise<Record<string, unknown>> {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? '' : Promise.reject(error)))
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new CoreError('invalid_args', `${file} is not valid JSON: fix it first`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError('invalid_args', `${file} is not a JSON object`)
  return value as Record<string, unknown>
}

// The string list at permissions[key] of a settings object, created when missing. invalid_args when it is something
// else than a list of strings.
function listOf(settings: Record<string, unknown>, key: string, file: string): string[] {
  const permissions = (settings.permissions ??= {})
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new CoreError('invalid_args', `${file}: "permissions" is not an object`)
  const holder = permissions as Record<string, unknown>
  const list = (holder[key] ??= [])
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) throw new CoreError('invalid_args', `${file}: "permissions.${key}" is not a list of strings`)
  return list as string[]
}

// Runs a read-change-write of one file after the previous one on that file has finished. Returns what it returns.
export function serialized<T>(file: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(run)
  queues.set(file, next)
  void next.finally(() => queues.get(file) === next && queues.delete(file)).catch(() => undefined)
  return next
}

// Writes text to a file through a symlink to the real file (configuration kept in git stays linked), atomically (temp
// file + rename), keeping the file's mode; the folder is created when missing.
export async function writeThrough(file: string, text: string): Promise<void> {
  const target = await realpath(file).catch(() => file)
  await mkdir(dirname(target), { recursive: true })
  const mode = ((await stat(target).catch(() => undefined))?.mode ?? 0o100644) & 0o777
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, text, { mode })
  await rename(temp, target)
}

// Applies a change to a settings file and saves it (through symlinks, atomically) when the change says so. Returns
// whether the file changed.
export function updateSettings(file: string, change: (settings: Record<string, unknown>) => boolean): Promise<boolean> {
  return serialized(file, async () => {
    const settings = await readSettings(await realpath(file).catch(() => file))
    if (!change(settings)) return false
    await writeThrough(file, `${JSON.stringify(settings, null, 2)}\n`)
    return true
  })
}

// Adds or removes a rule in a settings file. Adding one already there changes nothing; removing takes out the exact
// stored text (not_found when it is not there).
export async function changeRule(file: string, op: 'add' | 'remove', behavior: PermissionBehavior, text: string): Promise<void> {
  const rule = op === 'add' ? checkRule(text) : text
  let found = false
  await updateSettings(file, (settings) => {
    const list = listOf(settings, behavior, file)
    const at = list.indexOf(rule)
    found = at >= 0
    if (op === 'add') return !found && list.push(rule) > 0
    return found && list.splice(at, 1).length > 0
  })
  if (op === 'remove' && !found) throw new CoreError('not_found', `no ${behavior} rule "${rule.slice(0, 80)}" in ${file}`)
}

// The absolute folder for a path typed by the user: ~ is the home folder, a relative path starts at the session folder.
// not_found when it is not an existing folder.
async function folderOf(path: string, cwd: string): Promise<string> {
  const text = path.trim()
  const expanded = text === '~' || text.startsWith('~/') ? join(homedir(), text.slice(1)) : text
  const folder = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)
  const info = await stat(folder).catch(() => undefined)
  if (!info?.isDirectory()) throw new CoreError('not_found', `not a folder: ${folder}`)
  return folder
}

// Adds an extra working folder to a settings file, or removes one: looked for in the given destination first, then in
// the other settings files (the CLI may report a folder's source loosely). not_found when it is nowhere.
export async function changeDirectory(op: 'add' | 'remove', path: string, destination: SettingsDestination, cwd: string, claudeDir: string): Promise<void> {
  const file = (where: SettingsDestination) => settingsPath(where, cwd, claudeDir)
  if (op === 'add') {
    const folder = await folderOf(path, cwd)
    await updateSettings(file(destination), (settings) => {
      const list = listOf(settings, 'additionalDirectories', file(destination))
      return !list.includes(folder) && list.push(folder) > 0
    })
    return
  }
  for (const where of [destination, ...SETTINGS_DESTINATIONS.filter((other) => other !== destination)]) {
    const removed = await updateSettings(file(where), (settings) => {
      const permissions = settings.permissions as Record<string, unknown> | undefined
      if (!Array.isArray(permissions?.additionalDirectories) || !permissions.additionalDirectories.includes(path)) return false
      const list = listOf(settings, 'additionalDirectories', file(where))
      return list.splice(list.indexOf(path), 1).length > 0
    })
    if (removed) return
  }
  throw new CoreError('not_found', `no extra folder ${path} in the settings files`)
}

import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { WIDGET_LIMITS, WIDGET_NAME, type WidgetInfo } from '@athome/protocol'
import { CoreError } from './errors.ts'
import { serialized, writeThrough } from './settingsFiles.ts'
import { CREATE_COMMAND } from './widgetGuide.ts'

// The widget library (~/.claude/widgets/<name>.html) and the /creawidget command file, under the Claude config folder.

const DESCRIPTION = /<meta\s+name=["']description["']\s+content=(["'])(.*?)\1/i

const libraryDir = (claudeDir: string) => join(claudeDir, 'widgets')
const commandFile = (claudeDir: string) => join(claudeDir, 'commands', 'creawidget.md')

// The widgets of the library, sorted by name: .html files with a valid name (others skipped). Returns [] when the
// folder does not exist.
export async function listWidgets(claudeDir: string): Promise<WidgetInfo[]> {
  const files = await readdir(libraryDir(claudeDir)).catch(() => [] as string[])
  const names = files.filter((file) => file.endsWith('.html')).map((file) => file.slice(0, -5))
  const valid = names.filter((name) => WIDGET_NAME.test(name) && name.length <= WIDGET_LIMITS.name).sort()
  return Promise.all(valid.map(async (name) => ({ name, ...(await descriptionOf(join(libraryDir(claudeDir), `${name}.html`))) })))
}

// The description of a widget file: the content of its <meta name="description"> in the first KB ({} when none).
async function descriptionOf(file: string): Promise<{ description?: string }> {
  const head = (await readFile(file, 'utf8').catch(() => '')).slice(0, 1024)
  const description = DESCRIPTION.exec(head)?.[2]?.trim().slice(0, 500)
  return description ? { description } : {}
}

// A library widget's HTML. not_found when missing, too_large over WIDGET_LIMITS.htmlBytes, invalid_args for a bad name.
export async function readWidget(claudeDir: string, name: string): Promise<string> {
  if (!WIDGET_NAME.test(name)) throw new CoreError('invalid_args', `not a widget name: ${name}`)
  const file = join(libraryDir(claudeDir), `${name}.html`)
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) throw new CoreError('not_found', `no widget named ${name}`)
  if (info.size > WIDGET_LIMITS.htmlBytes) throw new CoreError('too_large', `larger than ${WIDGET_LIMITS.htmlBytes} bytes`)
  return readFile(file, 'utf8')
}

// Installs /creawidget (on) or removes it (off). A file the user changed is left as it is either way.
export function setCreateCommand(claudeDir: string, on: boolean): Promise<void> {
  const file = commandFile(claudeDir)
  return serialized(file, async () => {
    const current = await readFile(file, 'utf8').catch(() => undefined)
    if (current !== undefined && current !== CREATE_COMMAND) return
    if (on) await writeThrough(file, CREATE_COMMAND)
    else if (current !== undefined) await rm(file)
  })
}

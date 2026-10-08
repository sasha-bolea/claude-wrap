import { t } from '../i18n.ts'
import { useTouch, type LaterKey } from './context.tsx'
import { IconButton, Title } from './parts.tsx'

// The / command of the CLI that does the same meanwhile (Torna indietro has none that works from here).
const COMMANDS: Partial<Record<LaterKey, string>> = {
  context: '/context',
  usage: '/usage',
  tasks: '/tasks',
  todo: '/todos',
  diff: '/diff',
  config: '/config',
  memory: '/memory',
  skills: '/skills',
  agents: '/agents',
  styles: '/output-style',
  plugins: '/plugin'
}

// Placeholder of a panel or settings page to come (🔜): what it will show, and the / command to use meanwhile,
// written into the chat's composer when opened from a session.
export function LaterScreen({ which, tabId }: { which: LaterKey; tabId?: string }) {
  const { back, backTo, insertInComposer } = useTouch()
  const command = COMMANDS[which]
  const write = () => {
    insertInComposer(tabId!, { text: command!, replace: true })
    backTo((screen) => screen.name === 'chat' && screen.tabId === tabId)
  }
  return (
    <section className="screen" aria-label={t('laterTitle')}>
      <header className="topbar">
        <IconButton icon="back" label={t('back')} onClick={back} />
        <Title text={t(`later_${which}`)} sub={t('laterShort')} />
      </header>
      <div className="scroll">
        <div className="pad">
          <div className="card">
            <ul className="later-list">
              {t(`laterItems_${which}`)
                .split('\n')
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
            <div className="later-skeleton" aria-hidden="true">
              <i className="w90" />
              <i className="w70" />
              <i className="w80" />
            </div>
          </div>
          {command && tabId && (
            <button className="button block" onClick={write}>
              {t('writeInChat', { command })}
            </button>
          )}
          {command && !tabId && <p className="muted flat">{t('meanwhileInChat', { command })}</p>}
        </div>
      </div>
    </section>
  )
}

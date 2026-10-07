import { useEffect, useSyncExternalStore } from 'react'
import type { Effort, ModelInfo, PermissionMode, TabMeta } from '@athome/protocol'
import { t } from '../i18n.ts'
import type { MessageKey } from '../i18n/en.ts'
import { MODES, modeLabel } from '../modes.ts'
import { useTouch } from './context.tsx'
import { Icon, modeIcon } from './icons.tsx'
import { modelShortName } from './model.ts'

// Models offered by the CLI, per tab, once asked. Only the model sheet asks: on a dormant tab with nothing cached
// the question starts its process, which merely opening a chat must not do.
const models = new Map<string, ModelInfo[]>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener))
const remember = (tabId: string, list: ModelInfo[]) => (models.set(tabId, list), listeners.forEach((listener) => listener()))
export const useModels = (tabId: string) => useSyncExternalStore(subscribe, () => models.get(tabId))

const EFFORT_LABEL: Record<Effort, MessageKey> = { low: 'effortLow', medium: 'effortMedium', high: 'effortHigh', xhigh: 'effortVeryHigh', max: 'effortMax' }
export const effortLabel = (effort: Effort) => t(EFFORT_LABEL[effort])

// What the model button says: the model, with its version when known (the effort is `currentEffort`).
export function modelLabel(meta: TabMeta, list?: ModelInfo[]): string {
  const info = list?.find((model) => model.value === (meta.model ?? 'default'))
  return meta.model && info ? info.displayName : meta.activeModel ? modelShortName(meta.activeModel) : (info?.displayName ?? t('modelDefault'))
}

// The effort level of the session's model as a label, or undefined when the model has none.
// meta: the tab; list: the models offered, once known (until then a set effort counts as present).
export function currentEffort(meta: TabMeta, list?: ModelInfo[]): string | undefined {
  const info = list?.find((model) => model.value === (meta.model ?? 'default'))
  const hasEffort = info ? Boolean(info.supportedEffortLevels?.length) : Boolean(meta.effort)
  return hasEffort && meta.effort ? effortLabel(meta.effort).toLowerCase() : undefined
}

// Asks the CLI for the tab's models once mounted and returns them (undefined until known).
function useOfferedModels(tabId: string) {
  const { connection, fail } = useTouch()
  const list = useModels(tabId)
  useEffect(() => void connection.request('tab.models', { tabId }).then(({ models: offered }) => remember(tabId, offered), fail), [connection, tabId])
  return list
}

// "Modello e impegno": at the top the effort levels of the chosen model (none: no selector), under them every model with
// its version and a line about it. Changes apply at once; the sheet stays open.
export function ModelSheet({ tabId }: { tabId: string }) {
  const { state, connection, announce, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  const list = useOfferedModels(tabId)
  if (!meta) return null
  const current = meta.model ?? 'default'
  const levels = list?.find((model) => model.value === current)?.supportedEffortLevels ?? []
  const pickModel = (model: ModelInfo) =>
    connection.request('tab.setModel', { tabId, model: model.value }).then(() => announce(t('modelAnnounce', { model: model.displayName })), fail)
  const pickEffort = (effort: Effort) => connection.request('tab.setEffort', { tabId, effort }).then(() => announce(t('effortAnnounce', { effort: effortLabel(effort) })), fail)
  return (
    <>
    {levels.length > 0 && (
      <div className="group">
        <p className="label" id={`effort-${tabId}`}>
          {t('effort')}
        </p>
        <div className={`segmented effort cols-${levels.length}`} role="radiogroup" aria-labelledby={`effort-${tabId}`}>
          {levels.map((level) => (
            <label key={level}>
              <input type="radio" name={`effort-${tabId}`} value={level} checked={meta.effort === level} onChange={() => void pickEffort(level)} />
              <span>{effortLabel(level)}</span>
            </label>
          ))}
        </div>
      </div>
    )}
    <ul className="menu" role="radiogroup" aria-label={t('model')}>
      {!list && (
        <li className="muted" role="status">
          {t('loading')}
        </li>
      )}
      {list?.map((model) => (
        <li key={model.value}>
          <button role="radio" aria-checked={model.value === current} onClick={() => void pickModel(model)}>
            <span className="two-lines">
              <span>{model.displayName}</span>
              <small className="muted">{model.description}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
    </>
  )
}

// "Modalità permessi": the modes of the CLI, each with its icon; picking a mode closes the sheet.
export function ModeSheet({ tabId }: { tabId: string }) {
  const { state, connection, closeSheet, announce, fail } = useTouch()
  const meta = state.tabs.find((tab) => tab.tabId === tabId)
  if (!meta) return null
  const pick = (mode: PermissionMode) => {
    closeSheet()
    connection.request('tab.setMode', { tabId, mode }).then(() => announce(t('announceMode', { mode: t(modeLabel(mode)) })), fail)
  }
  return <ModeMenu current={meta.mode} onPick={pick} />
}

// The modes of the CLI as a radio menu, each with its icon.
// current: the checked mode; onPick: called with the mode tapped.
export function ModeMenu({ current, onPick }: { current: PermissionMode; onPick: (mode: PermissionMode) => void }) {
  return (
    <ul className="menu" role="radiogroup" aria-label={t('modeTitle')}>
      {MODES.map((mode) => (
        <li key={mode.value}>
          <button role="radio" aria-checked={mode.value === current} onClick={() => onPick(mode.value)}>
            <Icon name={modeIcon(mode.value)} />
            {t(mode.label)}
          </button>
        </li>
      ))}
    </ul>
  )
}

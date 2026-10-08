import { useCallback, useRef } from 'react'
import { CLIENT_ACTIONS, CORE_ACTIONS, type ClientActionArgs, type ClientActionName, type CoreActionName } from '@athome/protocol'
import { t } from '../i18n.ts'
import { useTouch, type Screen, type Touch } from './context.tsx'
import type { WidgetActionHandler } from './WidgetBlock.tsx'

// The actions a chat widget can ask for (the action API, protocol actions.ts), run for the chat it is in. Each one
// needs the user's tap: the page must hold a fresh user activation, which a tap inside the widget's frame gives it.
// Actions about this screen run here; the others go to core (actions.run), which asks before the heavy ones.

const isClientAction = (action: string): action is ClientActionName => Object.hasOwn(CLIENT_ACTIONS, action)
const isCoreAction = (action: string): action is CoreActionName => Object.hasOwn(CORE_ACTIONS, action)

// Whether the user has just tapped (inside the widget or the page): without it, a widget cannot act by itself.
function userJustTapped(): boolean {
  return navigator.userActivation?.isActive === true
}

// The screen a widget opens in its chat's session.
function screenFor(name: ClientActionArgs<'open.screen'>['name'], tabId: string): Screen {
  return name === 'settings' ? { name } : { name, tabId }
}

// Runs an action of the screen for a chat. Returns its value (none).
function runOnScreen(touch: Touch, tabId: string, action: ClientActionName, args: Record<string, unknown>): undefined {
  const parsed = CLIENT_ACTIONS[action].safeParse(args)
  if (!parsed.success) throw new Error(`${action}: invalid arguments`)
  if (action === 'composer.insert') {
    const { text, replace } = parsed.data as ClientActionArgs<'composer.insert'>
    touch.insertInComposer(tabId, { text, ...(replace ? { replace } : {}) })
  } else if (action === 'open.file') touch.go({ name: 'file', tabId, path: (parsed.data as ClientActionArgs<'open.file'>).path })
  else touch.go(screenFor((parsed.data as ClientActionArgs<'open.screen'>).name, tabId))
  return undefined
}

// Runs an action in core, then follows it on screen: a new session opens its chat (with its prompt in the composer
// when the folder must be trusted first).
async function runInCore(touch: Touch, tabId: string, action: CoreActionName, args: Record<string, unknown>): Promise<unknown> {
  const { value } = await touch.connection.request('actions.run', { tabId, action, args, source: 'widget' })
  if (action === 'session.start' && value && typeof value === 'object' && 'tabId' in value) {
    const started = value as { tabId: string; needsTrust?: boolean }
    if (started.needsTrust && typeof args.prompt === 'string') touch.insertInComposer(started.tabId, { text: args.prompt })
    touch.go({ name: 'chat', tabId: started.tabId })
  }
  return value
}

// The action handler of the widgets of one chat. tabId: the chat. Returns a stable handler that rejects with the
// reason when the action is refused (no tap, unknown action, bad arguments, denied, failed).
export function useWidgetActions(tabId: string): WidgetActionHandler {
  // The latest context, read when an action runs: a new context each render must not make a new handler.
  const current = useTouch()
  const touch = useRef(current)
  touch.current = current
  return useCallback(
    async (action, args) => {
      if (!userJustTapped()) throw new Error(t('widgetNeedsTap'))
      if (isClientAction(action)) return runOnScreen(touch.current, tabId, action, args)
      if (isCoreAction(action)) return runInCore(touch.current, tabId, action, args)
      throw new Error(`unknown action: ${action}`)
    },
    [tabId]
  )
}

import { createRoot } from 'react-dom/client'
import { Connection } from '@claude-wrap/client'
import { App } from '@claude-wrap/ui'
import '@claude-wrap/ui/style.css'
import type { BridgedChannel } from '../preload/index.ts'

declare global {
  interface Window {
    claudeWrap: {
      connect(backendId: string): Promise<BridgedChannel>
      chooseFolder(): Promise<string | undefined>
      openExternal(url: string): void
      onActivateTab(listener: (tabId: string) => void): () => void
      onCoreFailed(listener: () => void): () => void
    }
  }
}

// Stable id of this install, used by core to recognise retried commands across reconnects.
function getClientId(): string {
  const stored = localStorage.getItem('clientId')
  if (stored) return stored
  const created = crypto.randomUUID()
  localStorage.setItem('clientId', created)
  return created
}

const connection = new Connection({
  openChannel: () => window.claudeWrap.connect('local'),
  clientId: getClientId(),
  visible: () => document.visibilityState === 'visible'
})
const { chooseFolder, openExternal, onActivateTab, onCoreFailed } = window.claudeWrap
const capabilities = { chooseFolder, openExternal, onActivateTab, onCoreFailed }

createRoot(document.getElementById('root')!).render(<App connection={connection} capabilities={capabilities} />)

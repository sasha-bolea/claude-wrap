import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Connection } from '@athome/client'
import { DesktopShell, type BackendEntry, type Capabilities } from '@athome/ui'
import '@athome/ui/touch.css'
import type { BridgedChannel } from '../preload/index.ts'

type BackendInfo = { id: string; name: string; kind: 'local' | 'remote' }

declare global {
  interface Window {
    athome: {
      connect(backendId: string): Promise<BridgedChannel>
      chooseFolder(): Promise<string | undefined>
      openExternal(url: string): void
      onActivateTab(listener: (tabId: string, backendId: string) => void): () => void
      onCoreFailed(listener: () => void): () => void
      pathForFile(file: File): string
      listBackends(): Promise<BackendInfo[]>
      addBackend(link: string, name: string): Promise<BackendInfo>
      removeBackend(id: string): Promise<void>
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

const bridge = window.athome
// The local core runs on this computer: native folder picker, dropped file paths, core crash screen. A server
// has none of these (its folders are browsed through the protocol, files will be uploaded).
const LOCAL: Capabilities = { chooseFolder: bridge.chooseFolder, openExternal: bridge.openExternal, pathForFile: bridge.pathForFile, onCoreFailed: bridge.onCoreFailed }
const REMOTE: Capabilities = { openExternal: bridge.openExternal }

// A backend with its connection through main (MessagePort to the local core, or main's socket to the server).
function entry(info: BackendInfo): BackendEntry {
  const connection = new Connection({ openChannel: () => bridge.connect(info.id), clientId: getClientId(), visible: () => document.visibilityState === 'visible' })
  return { ...info, connection, capabilities: info.kind === 'local' ? LOCAL : REMOTE }
}

// Holds the backend list: adding pairs a server through main, removing forgets it and closes its connection.
function Root({ initial }: { initial: BackendEntry[] }) {
  const [backends, setBackends] = useState(initial)
  const add = async (link: string, name: string) => {
    const info = await bridge.addBackend(link, name)
    setBackends((list) => [...list, entry(info)])
  }
  const remove = async (id: string) => {
    await bridge.removeBackend(id)
    setBackends((list) => {
      list.find((backend) => backend.id === id)?.connection.close()
      return list.filter((backend) => backend.id !== id)
    })
  }
  return <DesktopShell backends={backends} onAdd={add} onRemove={remove} onActivate={bridge.onActivateTab} />
}

void bridge.listBackends().then((list) => createRoot(document.getElementById('root')!).render(<Root initial={list.map(entry)} />))

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

// The page's channel to a backend; MessagePorts never leave the preload.
export interface BridgedChannel {
  send(frame: unknown): void
  onMessage(listener: (frame: unknown) => void): void
  onClose(listener: () => void): void
  close(): void
}

// Asks main for a new port to a backend and wraps it.
// backendId: which backend ('local' for now). Returns the channel once main has sent the port.
function connect(backendId: string): Promise<BridgedChannel> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    const onPort = (event: IpcRendererEvent, reply: { requestId: string }) => {
      if (reply.requestId !== requestId) return
      ipcRenderer.removeListener('port', onPort)
      const port = event.ports[0]!
      resolve({
        send: (frame) => port.postMessage(frame),
        onMessage: (listener) => {
          port.addEventListener('message', (message) => listener(message.data))
          port.start()
        },
        onClose: (listener) => port.addEventListener('close', () => listener()),
        close: () => port.close()
      })
    }
    ipcRenderer.on('port', onPort)
    ipcRenderer.send('connect', backendId, requestId)
  })
}

// Subscribes to a main → page message. Returns the unsubscribe function.
function listen<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('claudeWrap', {
  connect,
  // Native folder picker (desktop only). Resolves to the path, or undefined if cancelled.
  chooseFolder: (): Promise<string | undefined> => ipcRenderer.invoke('choose-folder'),
  // Opens an https link in the system browser (main re-checks the scheme).
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),
  // A notification was clicked: show that tab of that backend.
  onActivateTab: (listener: (tabId: string, backendId: string) => void) => listen('activate-tab', listener),
  // Backends of this computer (local core + paired servers); add pairs from a pasted link, remove forgets one.
  listBackends: (): Promise<{ id: string; name: string; kind: 'local' | 'remote' }[]> => ipcRenderer.invoke('backends:list'),
  addBackend: (link: string, name: string): Promise<{ id: string; name: string; kind: 'remote' }> => ipcRenderer.invoke('backends:add', link, name),
  removeBackend: (id: string): Promise<void> => ipcRenderer.invoke('backends:remove', id),
  // The local core crashed too often and will not be restarted.
  onCoreFailed: (listener: () => void) => listen('core-failed', listener),
  // Local path of a file dropped on the page.
  pathForFile: (file: File): string => webUtils.getPathForFile(file)
})

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

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
  // A notification was clicked: show that tab.
  onActivateTab: (listener: (tabId: string) => void) => listen('activate-tab', listener),
  // The local core crashed too often and will not be restarted.
  onCoreFailed: (listener: () => void) => listen('core-failed', listener)
})

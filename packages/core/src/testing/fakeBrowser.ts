import type { BrowserSettings } from '../browser.ts'
import { createFakeCdp, type FakeCdp } from './fakeCdp.ts'

// A shared browser that needs no Chromium (PWA e2e, CLAUDE_WRAP_FAKE_BROWSER=1): "launch" is a no-op process and
// "connect" is a fake DevTools endpoint that sends a small frame every FRAME_EVERY_MS while a screencast runs.

const FRAME_EVERY_MS = 200
// A valid 2x2 JPEG (blue).
const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAB6Ev/2Q=='

export type FakeBrowser = { settings: BrowserSettings; cdps: FakeCdp[] }

// Makes the fake endpoint emit frames from startScreencast to stopScreencast, sized as the emulated page.
// cdp: the endpoint to drive.
function emitFramesWhileCasting(cdp: FakeCdp): void {
  let timer: ReturnType<typeof setInterval> | undefined
  let size = { width: 1280, height: 800 }
  let ack = 0
  const stop = () => (clearInterval(timer), (timer = undefined))
  cdp.answer('Emulation.setDeviceMetricsOverride', (params) => void (size = { width: (params as typeof size).width, height: (params as typeof size).height }))
  cdp.answer('Page.startScreencast', (_params, sessionId) => {
    stop()
    timer = setInterval(() => cdp.emit('Page.screencastFrame', { data: TINY_JPEG, metadata: { deviceWidth: size.width, deviceHeight: size.height }, sessionId: ++ack }, sessionId), FRAME_EVERY_MS)
    timer.unref()
  })
  cdp.answer('Page.stopScreencast', stop)
}

// Settings for a core's browser: fake launch and connect. Every connect makes a new endpoint, kept in cdps (the
// calls a test may check).
export function createFakeBrowser(): FakeBrowser {
  const cdps: FakeCdp[] = []
  const settings: BrowserSettings = {
    port: 3013,
    executable: '/fake/chrome',
    profileDir: '/fake/profile',
    launch: () => ({ kill: () => undefined, exited: new Promise<void>(() => undefined) }),
    connect: async () => {
      const cdp = createFakeCdp()
      emitFramesWhileCasting(cdp)
      cdps.push(cdp)
      return cdp.transport
    }
  }
  return { settings, cdps }
}

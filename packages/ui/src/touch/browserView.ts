import type { Item } from '@athome/protocol'

// Pure helpers of the shared browser's screen (BrowserScreen.tsx): what is typed in the address field, where the page
// is drawn inside the canvas, where a tap lands on the page, and the frame's image.

// The address typed by hand as a web address: "example.com" and "localhost:3000" get https://, a full one stays.
// text: what is in the field. Returns '' when it is empty.
export function normalizeUrl(text: string): string {
  const typed = text.trim()
  if (!typed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`
}

// The site of an address for display ("example.com"); the address itself when it does not parse. about:blank → ''.
export function hostOf(url: string): string {
  if (url === 'about:blank') return ''
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export type Box = { x: number; y: number; width: number; height: number }

// Where a frame of frameWidth×frameHeight is drawn inside a canvas of canvasWidth×canvasHeight: as large as fits,
// centred (the bands left and right or above and below stay empty).
export function frameBox(canvasWidth: number, canvasHeight: number, frameWidth: number, frameHeight: number): Box {
  if (!frameWidth || !frameHeight) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  const scale = Math.min(canvasWidth / frameWidth, canvasHeight / frameHeight)
  const width = frameWidth * scale
  const height = frameHeight * scale
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height }
}

// A point of the canvas (same unit as the box) as fractions 0..1 of the page, or undefined outside the drawn page;
// clamp: a point outside lands on the page's edge instead (a finger lifted off the page).
export function pageFraction(box: Box, x: number, y: number, clamp = false): { x: number; y: number } | undefined {
  if (box.width <= 0 || box.height <= 0) return undefined
  const fx = (x - box.x) / box.width
  const fy = (y - box.y) / box.height
  if (clamp) return { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) }
  return fx < 0 || fx > 1 || fy < 0 || fy > 1 ? undefined : { x: fx, y: fy }
}

// The page size to ask for: the canvas box in whole CSS px within the protocol's limits, a phone page being "mobile"
// with the screen's pixel ratio (at most 2), a desktop one not.
export function viewportFor(width: number, height: number, phone: boolean, ratio: number): { width: number; height: number; mobile: boolean; scale: number } {
  const clamp = (value: number) => Math.min(4000, Math.max(200, Math.round(value)))
  return { width: clamp(width), height: clamp(height), mobile: phone, scale: phone ? Math.min(2, Math.max(1, ratio)) : 1 }
}

// The bytes of a base64 JPEG as an image blob (a frame's data).
export function jpegBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: 'image/jpeg' })
}

// Whether this chat's Claude is using the browser now: one of its browser (Playwright MCP) tool calls has no result yet.
// items: the chat's transcript.
export function actingInBrowser(items: Item[]): boolean {
  return items.some((item) => item.kind === 'toolCall' && item.name.startsWith('mcp__playwright__') && item.result === undefined)
}

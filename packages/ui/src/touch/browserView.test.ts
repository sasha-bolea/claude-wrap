// The shared browser's screen helpers: address typed, drawn page, tap position, page size.
import { describe, expect, it } from 'vitest'
import type { Item } from '@athome/protocol'
import { actingInBrowser, frameBox, hostOf, normalizeUrl, pageFraction, viewportFor } from './browserView.ts'

describe('browser view helpers', () => {
  it('a typed address gets https:// unless it has a scheme', () => {
    expect(normalizeUrl(' example.com/a ')).toBe('https://example.com/a')
    expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeUrl('  ')).toBe('')
  })

  it('shows the site of an address', () => {
    expect(hostOf('https://example.com/page?x=1')).toBe('example.com')
    expect(hostOf('about:blank')).toBe('')
    expect(hostOf('nonsense')).toBe('nonsense')
  })

  it('draws the page letterboxed and maps a tap to the page', () => {
    const box = frameBox(400, 800, 200, 100)
    expect(box).toEqual({ x: 0, y: 300, width: 400, height: 200 })
    expect(pageFraction(box, 200, 400)).toEqual({ x: 0.5, y: 0.5 })
    expect(pageFraction(box, 200, 100)).toBeUndefined()
    expect(pageFraction(box, 500, 100, true)).toEqual({ x: 1, y: 0 })
    expect(frameBox(400, 800, 0, 0)).toEqual({ x: 0, y: 0, width: 400, height: 800 })
  })

  it('asks a phone page with the pixel ratio (at most 2) and a desktop one without', () => {
    expect(viewportFor(390.4, 600, true, 3)).toEqual({ width: 390, height: 600, mobile: true, scale: 2 })
    expect(viewportFor(100, 9000, false, 2)).toEqual({ width: 200, height: 4000, mobile: false, scale: 1 })
  })

  it('a chat acts in the browser while one of its browser tool calls waits for its result', () => {
    const call = (name: string, result?: string) => ({ kind: 'toolCall', itemId: name, name, input: {}, result }) as unknown as Item
    expect(actingInBrowser([call('mcp__playwright__browser_click')])).toBe(true)
    expect(actingInBrowser([call('mcp__playwright__browser_click', 'done'), call('Bash')])).toBe(false)
    expect(actingInBrowser([])).toBe(false)
  })
})

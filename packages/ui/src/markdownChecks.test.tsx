// User story: the boxes of a checklist Claude wrote can be ticked in the chat; elsewhere (plans, file previews) they
// stay as written, read only.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown.tsx'

const LIST = '- [ ] first\n- [x] second\n\n1. [ ] third'
// The checkbox inputs of the rendered markup.
const boxes = (html: string) => html.match(/<input[^>]*>/g) ?? []

describe('markdown checklists', () => {
  it('without ticks to keep, the boxes are read only, as written', () => {
    const inputs = boxes(renderToStaticMarkup(<Markdown text={LIST} />))
    expect(inputs).toHaveLength(3)
    expect(inputs.every((input) => input.includes('disabled'))).toBe(true)
    expect(inputs.map((input) => input.includes('checked'))).toEqual([false, true, false])
  })

  it('with ticks, every box is numbered in order and shows the tick kept, else the written one', () => {
    const checks = { ticked: { 0: true, 1: false }, toggle: () => undefined }
    const inputs = boxes(renderToStaticMarkup(<Markdown text={LIST} checks={checks} />))
    expect(inputs.some((input) => input.includes('disabled'))).toBe(false)
    expect(inputs.map((input) => input.match(/data-index="(\d+)"/)?.[1])).toEqual(['0', '1', '2'])
    expect(inputs.map((input) => input.includes('checked'))).toEqual([true, false, false])
  })
})

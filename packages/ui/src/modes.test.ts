import { describe, expect, it } from 'vitest'
import { nextMode } from './modes.ts'

describe('Shift+Tab mode cycle', () => {
  it('goes default → acceptEdits → plan → default, and restarts from modes outside the cycle', () => {
    expect([nextMode('default'), nextMode('acceptEdits'), nextMode('plan'), nextMode('auto')]).toEqual(['acceptEdits', 'plan', 'default', 'default'])
  })
})

import { describe, expect, it } from 'vitest'
import { orphanChildren, sweepTargets } from './process.ts'

describe('orphan cleanup', () => {
  it('takes only the direct children created after the exited process started', () => {
    const processes = [
      { pid: 10, ppid: 1, created: 1000 }, // the exited claude itself (not its own child)
      { pid: 11, ppid: 10, created: 1500 }, // MCP server started by claude → orphan
      { pid: 12, ppid: 10, created: 500 }, // older process whose dead parent's PID was reused → not ours
      { pid: 13, ppid: 11, created: 1600 } // grandchild: killed with its parent's tree
    ]
    expect(orphanChildren(processes, 10, 1000)).toEqual([11])
  })
  it('startup sweep: kills a recorded claude still running, and the orphans of one already gone, never a reused PID', () => {
    const processes = [
      { pid: 20, ppid: 1, created: 10_000 }, // recorded claude, still alive
      { pid: 30, ppid: 1, created: 99_000 }, // PID 30 reused by an unrelated, much newer process
      { pid: 31, ppid: 40, created: 20_500 }, // MCP server orphaned by claude 40, which is gone
      { pid: 32, ppid: 40, created: 5_000 } // older than claude 40: not its child
    ]
    const recorded = [
      { pid: 20, startedAt: 10_300 },
      { pid: 30, startedAt: 15_000 },
      { pid: 40, startedAt: 20_000 }
    ]
    expect(sweepTargets(processes, recorded)).toEqual([20, 31])
  })
})

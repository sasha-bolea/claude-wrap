import { randomUUID } from 'node:crypto'
import {
  PROTOCOL_VERSION,
  coreFrameSchema,
  createChannelPair,
  type Channel,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type CoreFrame,
  type EvFrame,
  type ProtocolError,
  type Reply,
  type ResetFrame,
  type StreamPosition
} from '@claude-wrap/protocol'
import type { Core } from '../core.ts'

// Protocol-level test client: speaks raw frames to a core and records everything it receives.
export class RawClient {
  readonly frames: CoreFrame[] = []
  closed = false
  private readonly channel: Channel
  private listeners: (() => void)[] = []
  readonly clientId: string

  // core: the core to attach to; clientId: identity sent in hello.
  constructor(core: Core, clientId = 'client-a') {
    this.clientId = clientId
    const [mine, coreEnd] = createChannelPair()
    this.channel = mine
    mine.onMessage((raw) => {
      this.frames.push(coreFrameSchema.parse(raw))
      this.listeners.splice(0).forEach((listener) => listener())
    })
    mine.onClose(() => (this.closed = true))
    core.attach(coreEnd)
  }

  // Sends hello and waits for welcome. resume: stream positions to resume.
  async hello(resume: Record<string, StreamPosition> = {}): Promise<void> {
    this.channel.send({ t: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: this.clientId, visible: true, resume })
    await this.waitFor(() => this.frames.some((frame) => frame.t === 'welcome'))
  }

  // Sends a raw command and waits for its reply. Returns the reply frame.
  async cmd(name: string, args: unknown, id: string = randomUUID()): Promise<Reply> {
    this.channel.send({ t: 'cmd', id, name, args })
    await this.waitFor(() => this.reply(id) !== undefined)
    return this.reply(id)!
  }

  // Sends a command and returns its result; throws the protocol error if it failed.
  async ok<N extends CommandName>(name: N, args: CommandArgs<N>, id?: string): Promise<CommandResult<N>> {
    const reply = await this.cmd(name, args, id)
    if (!reply.ok) throw Object.assign(new Error(reply.error.message), reply.error)
    return reply.result as CommandResult<N>
  }

  // Sends a command and returns its error (throws if it succeeded).
  async fails(name: string, args: unknown): Promise<ProtocolError> {
    const reply = await this.cmd(name, args)
    if (reply.ok) throw new Error(`${name} unexpectedly succeeded`)
    return reply.error
  }

  // Events received on a stream, in order.
  events(stream: string): EvFrame['ev'][] {
    return this.frames.flatMap((frame) => (frame.t === 'ev' && frame.stream === stream ? [frame.ev] : []))
  }

  // Last reset received on a stream.
  lastReset(stream: string): ResetFrame | undefined {
    return this.frames.filter((frame): frame is ResetFrame => frame.t === 'reset' && frame.stream === stream).at(-1)
  }

  // Resolves when predicate becomes true (checked after every frame), or rejects after timeoutMs.
  async waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('waitFor timed out')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 20))
        this.listeners.push(() => (clearTimeout(timer), resolve()))
      })
    }
  }

  close(): void {
    this.channel.close()
  }

  private reply(id: string): Reply | undefined {
    return this.frames.find((frame): frame is Reply => frame.t === 'reply' && frame.id === id)
  }
}

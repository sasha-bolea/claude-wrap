import type { ErrorCode } from '@athome/protocol'

// Error with a protocol code: command handlers throw it and the reply carries {code, message}.
export class CoreError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// Message of any thrown value.
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

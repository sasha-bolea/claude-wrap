import { describe, it, expect } from 'vitest'
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { createFakeSdk } from './fakeQuery.ts'

describe('FakeSession', () => {
  describe('rewindFiles', () => {
    it('records rewindFiles calls', async () => {
      const fake = createFakeSdk()
      const query = fake.query({
        prompt: (async function* () {})(),
        options: {}
      })

      // Call rewindFiles
      const result = await query.rewindFiles('msg-123', { dryRun: true })

      // Verify the call was recorded
      const session = fake.last()
      expect(session.rewindCalls).toHaveLength(1)
      expect(session.rewindCalls[0]).toEqual({ userMessageId: 'msg-123', dryRun: true })
    })

    it('returns default error when no result is configured', async () => {
      const fake = createFakeSdk()
      const query = fake.query({
        prompt: (async function* () {})(),
        options: {}
      })

      const result = await query.rewindFiles('msg-unknown')
      expect(result.canRewind).toBe(false)
      expect(result.error).toBe('No file checkpoint found for this message.')
    })

    it('returns configured result', async () => {
      const fake = createFakeSdk()
      const query = fake.query({
        prompt: (async function* () {})(),
        options: {}
      })

      const session = fake.last()
      const configured = { canRewind: true, filesChanged: ['file.ts'], insertions: 10, deletions: 5 }
      session.rewindResults.set('msg-123', configured)

      const result = await query.rewindFiles('msg-123', { dryRun: true })
      expect(result).toEqual(configured)
    })

    it('differentiates between dryRun and non-dryRun calls', async () => {
      const fake = createFakeSdk()
      const query = fake.query({
        prompt: (async function* () {})(),
        options: {}
      })

      const session = fake.last()
      await query.rewindFiles('msg-1', { dryRun: true })
      await query.rewindFiles('msg-1', { dryRun: false })
      await query.rewindFiles('msg-1')

      expect(session.rewindCalls).toHaveLength(3)
      expect(session.rewindCalls[0]?.dryRun).toBe(true)
      expect(session.rewindCalls[1]?.dryRun).toBe(false)
      expect(session.rewindCalls[2]?.dryRun).toBeUndefined()
    })
  })

  describe('resumeSessionAt', () => {
    it('tracks resumeSessionAt option', async () => {
      const fake = createFakeSdk()
      const query = fake.query({
        prompt: (async function* () {})(),
        options: { resume: 'session-1', resumeSessionAt: 'msg-456' }
      })

      const session = fake.last()
      expect(session.resumeSessionAt).toBe('msg-456')
    })

    it('truncates history at resumeSessionAt point', async () => {
      const fake = createFakeSdk()

      // Create a session and add some history
      fake.record('session-1', '/tmp', {
        type: 'user',
        uuid: 'msg-1',
        message: { type: 'text', content: 'hello' },
        input_tokens: 100
      } as unknown as SessionMessage)
      fake.record('session-1', '/tmp', {
        type: 'assistant',
        uuid: 'msg-2',
        message: { content: 'hi' },
        output_tokens: 50
      } as unknown as SessionMessage)
      fake.record('session-1', '/tmp', {
        type: 'user',
        uuid: 'msg-3',
        message: { type: 'text', content: 'how are you' },
        input_tokens: 100
      } as unknown as SessionMessage)

      // Resume at msg-2 (truncate after msg-2)
      const query = fake.query({
        prompt: (async function* () {})(),
        options: { resume: 'session-1', resumeSessionAt: 'msg-2' }
      })

      // Get the history - should only have msg-1 and msg-2
      const history = await fake.getSessionMessages('session-1')
      expect(history).toHaveLength(2)
      expect(history[0]?.uuid).toBe('msg-1')
      expect(history[1]?.uuid).toBe('msg-2')
    })

    it('returns full history when resumeSessionAt is not set', async () => {
      const fake = createFakeSdk()

      // Create a session with history
      fake.record('session-2', '/tmp', {
        type: 'user',
        uuid: 'msg-1',
        message: { type: 'text', content: 'hello' },
        input_tokens: 100
      } as unknown as SessionMessage)
      fake.record('session-2', '/tmp', {
        type: 'assistant',
        uuid: 'msg-2',
        message: { content: 'hi' },
        output_tokens: 50
      } as unknown as SessionMessage)

      // Query without resumeSessionAt
      const query = fake.query({
        prompt: (async function* () {})(),
        options: { resume: 'session-2' }
      })

      // Get the history - should have all messages
      const history = await fake.getSessionMessages('session-2')
      expect(history).toHaveLength(2)
    })

    it('keeps records appended after the resume point', async () => {
      const fake = createFakeSdk()
      for (const uuid of ['msg-1', 'msg-2', 'msg-3']) {
        fake.record('session-4', '/tmp', { type: 'user', uuid } as unknown as SessionMessage)
      }

      fake.query({ prompt: (async function* () {})(), options: { resume: 'session-4', resumeSessionAt: 'msg-1' } })
      fake.record('session-4', '/tmp', { type: 'user', uuid: 'msg-4' } as unknown as SessionMessage)

      const history = await fake.getSessionMessages('session-4')
      expect(history.map((message) => message.uuid)).toEqual(['msg-1', 'msg-4'])
    })

    it('handles resumeSessionAt UUID not found gracefully', async () => {
      const fake = createFakeSdk()

      // Create a session with history
      fake.record('session-3', '/tmp', {
        type: 'user',
        uuid: 'msg-1',
        message: { type: 'text', content: 'hello' },
        input_tokens: 100
      } as unknown as SessionMessage)

      // Resume at non-existent UUID
      const query = fake.query({
        prompt: (async function* () {})(),
        options: { resume: 'session-3', resumeSessionAt: 'non-existent' }
      })

      // Get the history - should return all messages since UUID was not found
      const history = await fake.getSessionMessages('session-3')
      expect(history).toHaveLength(1)
    })
  })
})

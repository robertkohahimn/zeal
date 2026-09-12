import { describe, expect, it } from 'vitest'
import { normalizeEvent, textOf } from '../src/tui/normalize.ts'
import { fixtures } from './fixtures/events.ts'

describe('normalizeEvent', () => {
  it('maps a text stream chunk to text-delta', () => {
    expect(normalizeEvent(fixtures.textChunk('hi', 7))).toEqual({ t: 'text-delta', seq: 7, text: 'hi' })
  })

  it('maps a reasoning chunk to reasoning-delta', () => {
    expect(normalizeEvent(fixtures.reasoningChunk('mm', 8))).toEqual({ t: 'reasoning-delta', seq: 8, text: 'mm' })
  })

  it('maps tool call and result with callId correlation', () => {
    expect(normalizeEvent(fixtures.toolCall('call_1', 'bash', '{"cmd":"ls"}', 9)))
      .toEqual({ t: 'tool-call', seq: 9, callId: 'call_1', name: 'bash', args: '{"cmd":"ls"}' })
    const r = normalizeEvent(fixtures.toolResult('call_1', false, 'file1\nfile2', 10))
    expect(r).toMatchObject({ t: 'tool-result', callId: 'call_1', ok: true })
  })

  it('maps turn/end reasons to outcomes', () => {
    expect(normalizeEvent(fixtures.turnEnd('completed', 11))).toMatchObject({ t: 'turn-end', outcome: 'completed' })
    expect(normalizeEvent(fixtures.turnEnd('aborted', 12))).toMatchObject({ t: 'turn-end', outcome: 'aborted' })
  })

  it('passes unknown events through as other', () => {
    expect(normalizeEvent(fixtures.unknown(13))).toEqual({ t: 'other', seq: 13 })
  })

  it('maps turn/start', () => {
    expect(normalizeEvent(fixtures.turnStart(1))).toEqual({ t: 'turn-start', seq: 1 })
  })

  it('maps user/message, joining only text blocks', () => {
    expect(normalizeEvent(fixtures.userMessage('hello there', 2)))
      .toEqual({ t: 'user-message', seq: 2, text: 'hello there' })
  })

  it('maps assistant/message, splitting text and reasoning', () => {
    expect(normalizeEvent(fixtures.assistantMessage('the answer', 'let me think', 3)))
      .toEqual({ t: 'assistant-message', seq: 3, text: 'the answer', reasoning: 'let me think' })
  })

  // I5 (Ruling R4): usage folds into totalTokens = the three disjoint
  // "billed input" counts (inputTokens + cacheReadTokens + cacheWriteTokens)
  // plus this request's outputTokens.
  it('maps assistant/message usage into totalTokens (I5, Ruling R4)', () => {
    const r = normalizeEvent(fixtures.assistantMessage('answer', 'thinking', 5, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    }))
    expect(r).toEqual({
      t: 'assistant-message',
      seq: 5,
      text: 'answer',
      reasoning: 'thinking',
      totalTokens: 165,
    })
  })

  it('omits totalTokens from assistant/message entirely when the raw event carries no usage', () => {
    const r = normalizeEvent(fixtures.assistantMessage('answer', '', 5))
    expect(r).toEqual({ t: 'assistant-message', seq: 5, text: 'answer', reasoning: '' })
    expect('totalTokens' in r).toBe(false)
  })

  it('omits absent optional cache fields from the totalTokens sum (treated as 0)', () => {
    const r = normalizeEvent(fixtures.assistantMessage('answer', '', 6, { inputTokens: 200, outputTokens: 20 }))
    expect(r).toMatchObject({ totalTokens: 220 })
  })

  it('maps a failing tool/result to ok: false and previews the content', () => {
    const r = normalizeEvent(fixtures.toolResult('call_2', true, 'boom', 14))
    expect(r).toEqual({ t: 'tool-result', seq: 14, callId: 'call_2', ok: false, preview: 'boom' })
  })

  it('truncates tool-result previews at 2000 characters', () => {
    const long = 'x'.repeat(3000)
    const r = normalizeEvent(fixtures.toolResult('call_3', false, long, 15))
    expect(r).toMatchObject({ t: 'tool-result', preview: 'x'.repeat(2000) })
  })

  it('maps request/header', () => {
    expect(normalizeEvent(fixtures.requestHeader('zhipu', 'glm-4.7', 4)))
      .toEqual({ t: 'request-header', seq: 4, provider: 'zhipu', model: 'glm-4.7' })
  })

  it('folds blocked and interrupted turn/end reasons into aborted', () => {
    expect(normalizeEvent(fixtures.turnEnd('blocked', 16))).toMatchObject({ t: 'turn-end', outcome: 'aborted' })
    expect(normalizeEvent(fixtures.turnEnd('interrupted', 17))).toMatchObject({ t: 'turn-end', outcome: 'aborted' })
  })

  it('folds max-tokens turn/end into completed', () => {
    expect(normalizeEvent(fixtures.turnEnd('max-tokens', 18))).toMatchObject({ t: 'turn-end', outcome: 'completed' })
  })

  it('maps an error turn/end with its error code and message', () => {
    expect(normalizeEvent(fixtures.turnEndError('RATE_LIMIT', 'too many requests', 19)))
      .toEqual({ t: 'turn-end', seq: 19, outcome: 'error', errorCode: 'RATE_LIMIT', errorMessage: 'too many requests' })
  })

  // I6b (final-review fix wave, Ruling R5): a completed compaction cycle
  // folds into a fixed info notice, regardless of payload content.
  it('maps compaction/end to a fixed info notice', () => {
    expect(normalizeEvent(fixtures.compactionEnd(20)))
      .toEqual({ t: 'notice', seq: 20, level: 'info', text: 'context compacted' })
  })
})

describe('textOf', () => {
  it('joins only text blocks, in order', () => {
    expect(textOf([{ type: 'reasoning', text: 'skip' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))
      .toBe('ab')
  })

  it('returns an empty string for no text blocks', () => {
    expect(textOf([{ type: 'reasoning', text: 'skip' }])).toBe('')
  })
})

/**
 * fast-check arbitraries generating well-formed `SessionEvent` sequences for
 * `store.test.ts`'s property tests. Built exclusively from Task 4's fixture
 * builders (`../fixtures/events.ts`) — this file never hand-rolls a raw event
 * shape, matching that module's own stated invariant for test code.
 * @module @zealagent/dsh-zeal/tests/fixtures/arbitraries
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import fc from 'fast-check'
import { fixtures } from './events.ts'

interface DeltaSpec { kind: 'text' | 'reasoning'; text: string }
interface ToolPairSpec { name: string; args: string; isError: boolean; resultText: string }
type EndSpec =
  | { kind: 'completed' }
  | { kind: 'aborted' }
  | { kind: 'error'; code: string; message: string }
interface TurnSpec {
  deltas: DeltaSpec[]
  tools: ToolPairSpec[]
  assistantText: string
  assistantReasoning: string
  end: EndSpec
}

const deltaArb: fc.Arbitrary<DeltaSpec> = fc.record({
  kind: fc.constantFrom('text', 'reasoning'),
  text: fc.string({ maxLength: 8 }),
})

const toolPairArb: fc.Arbitrary<ToolPairSpec> = fc.record({
  name: fc.constantFrom('bash', 'read', 'edit'),
  args: fc.string({ maxLength: 8 }),
  isError: fc.boolean(),
  resultText: fc.string({ maxLength: 8 }),
})

const endArb: fc.Arbitrary<EndSpec> = fc.oneof(
  fc.record({ kind: fc.constant('completed' as const) }),
  fc.record({ kind: fc.constant('aborted' as const) }),
  fc.record({
    kind: fc.constant('error' as const),
    code: fc.string({ minLength: 1, maxLength: 6 }),
    message: fc.string({ minLength: 1, maxLength: 12 }),
  }),
)

const turnArb: fc.Arbitrary<TurnSpec> = fc.record({
  deltas: fc.array(deltaArb, { maxLength: 4 }),
  tools: fc.array(toolPairArb, { maxLength: 3 }),
  assistantText: fc.string({ maxLength: 10 }),
  assistantReasoning: fc.string({ maxLength: 10 }),
  end: endArb,
})

/**
 * A 1–3 turn `SessionEvent` sequence, each turn shaped
 * `turn-start, interleaved deltas, 0-3 tool call/result pairs,
 * assistant-message, turn-end`, with strictly increasing `seq` across the
 * whole sequence (spanning turns).
 */
export function eventSequence(): fc.Arbitrary<SessionEvent[]> {
  return fc.array(turnArb, { minLength: 1, maxLength: 3 }).map((turns) => {
    let seq = 1
    let callCounter = 0
    const events: SessionEvent[] = []
    for (const turn of turns) {
      events.push(fixtures.turnStart(seq++))
      for (const delta of turn.deltas) {
        events.push(
          delta.kind === 'text'
            ? fixtures.textChunk(delta.text, seq++)
            : fixtures.reasoningChunk(delta.text, seq++),
        )
      }
      for (const tool of turn.tools) {
        const callId = `call_${callCounter++}`
        events.push(fixtures.toolCall(callId, tool.name, tool.args, seq++))
        events.push(fixtures.toolResult(callId, tool.isError, tool.resultText, seq++))
      }
      events.push(fixtures.assistantMessage(turn.assistantText, turn.assistantReasoning, seq++))
      events.push(
        turn.end.kind === 'error'
          ? fixtures.turnEndError(turn.end.code, turn.end.message, seq++)
          : fixtures.turnEnd(turn.end.kind, seq++),
      )
    }
    return events
  })
}

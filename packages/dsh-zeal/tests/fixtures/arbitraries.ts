/**
 * fast-check arbitraries generating well-formed `SessionEvent` sequences for
 * `store.test.ts`'s property tests. Built exclusively from Task 4's fixture
 * builders (`../fixtures/events.ts`) — this file never hand-rolls a raw event
 * shape, matching that module's own stated invariant for test code.
 *
 * Beyond the brief's literal "turn-start, deltas, 0-3 tool pairs,
 * assistant-message, turn-end" shape, this generator also (per task-5 review
 * finding 3):
 *   - sometimes omits the trailing `assistant-message`, so a turn can end
 *     with only live text/reasoning still pending (exercising the
 *     turn-end settle-leftover-live-content path, including the
 *     reasoning-only case fixed for finding 1);
 *   - occasionally injects an orphan `tool-result` whose `callId` matches no
 *     live tool call (exercising the no-matching-call no-op path).
 * Both are still well-formed `SessionEvent` sequences with strictly
 * increasing `seq` — neither should ever change what the two invariants
 * (idempotent replay; settled only grows, in seq order) assert.
 * @module @zealagent/dsh-zeal/tests/fixtures/arbitraries
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import fc from 'fast-check'
import { fixtures } from './events.ts'

interface DeltaSpec { kind: 'text' | 'reasoning'; text: string }
interface ToolPairSpec { name: string; args: string; isError: boolean; resultText: string }
interface OrphanResultSpec { isError: boolean; resultText: string }
type EndSpec =
  | { kind: 'completed' }
  | { kind: 'aborted' }
  | { kind: 'error'; code: string; message: string }
interface TurnSpec {
  deltas: DeltaSpec[]
  tools: ToolPairSpec[]
  // Not optional (`?`) — `exactOptionalPropertyTypes` distinguishes "key
  // absent" from "key present with value undefined", and fc.record always
  // produces the key. The explicit `| undefined` matches what fc.record
  // actually generates.
  assistantMessage: { text: string; reasoning: string } | undefined
  orphanResult: OrphanResultSpec | undefined
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

const orphanResultArb: fc.Arbitrary<OrphanResultSpec> = fc.record({
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

// Explicit weighted oneof (rather than fc.option's `1/freq` framing) so the
// intended ratios read directly off the weights.
const assistantMessageArb: fc.Arbitrary<{ text: string; reasoning: string } | undefined> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ text: fc.string({ maxLength: 10 }), reasoning: fc.string({ maxLength: 10 }) }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
)
const maybeOrphanResultArb: fc.Arbitrary<OrphanResultSpec | undefined> = fc.oneof(
  { weight: 1, arbitrary: orphanResultArb },
  { weight: 3, arbitrary: fc.constant(undefined) },
)

const turnArb: fc.Arbitrary<TurnSpec> = fc.record({
  deltas: fc.array(deltaArb, { maxLength: 4 }),
  tools: fc.array(toolPairArb, { maxLength: 3 }),
  // ~2/3 of turns get a trailing assistant-message; the rest leave whatever
  // live text/reasoning accumulated to settle at turn-end instead.
  assistantMessage: assistantMessageArb,
  // ~1/4 of turns also fire an orphan tool-result (unknown callId) just
  // before turn-end.
  orphanResult: maybeOrphanResultArb,
  end: endArb,
})

/**
 * A 1–3 turn `SessionEvent` sequence, each turn shaped `turn-start,
 * interleaved deltas, 0-3 tool call/result pairs, [assistant-message],
 * [orphan tool-result], turn-end`, with strictly increasing `seq` across the
 * whole sequence (spanning turns). The assistant-message and orphan-result
 * are each present only some of the time — see module doc.
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
      if (turn.assistantMessage) {
        events.push(fixtures.assistantMessage(turn.assistantMessage.text, turn.assistantMessage.reasoning, seq++))
      }
      if (turn.orphanResult) {
        // `orphan_<seq>` can never collide with a `call_<n>` id minted above.
        events.push(fixtures.toolResult(`orphan_${seq}`, turn.orphanResult.isError, turn.orphanResult.resultText, seq++))
      }
      events.push(
        turn.end.kind === 'error'
          ? fixtures.turnEndError(turn.end.code, turn.end.message, seq++)
          : fixtures.turnEnd(turn.end.kind, seq++),
      )
    }
    return events
  })
}

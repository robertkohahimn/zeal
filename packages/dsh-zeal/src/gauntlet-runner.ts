/**
 * @zealagent/dsh-zeal/gauntlet-runner — one-shot direct Agent driver for the
 * offline gauntlet harness (`gauntlet/run.sh`). Mirrors
 * `$DSH_SRC/packages/bundle/headless/src/index.ts`'s `run()` closely: the
 * bundle patch rides over dsh-base without Host, HTTP, or browser plugins, so
 * this runner creates one Agent through the core registry, drives the task
 * to quiescence, flushes its Session, prints the final assistant text, and
 * exits — exactly headless's own sequence, just sourced from the gauntlet
 * overlay's `task` config instead of a launcher-parsed CLI argument.
 *
 * MACHINE SUBSTITUTES (spec A11+D1, this task's binding requirement): a
 * gauntlet run has no human at the terminal, so BOTH interactive answerer
 * seams this bundle composes (`@deepseek-ai/dsh-user-approval`,
 * `@deepseek-ai/dsh-user-questions`) need a machine-driven stand-in or every
 * approval-gated tool call and every `ask_user_question` call would hang
 * forever (both seams fail closed with nothing composed — see
 * `tui/answerers.ts`'s module doc for the same fail-closed framing on the
 * interactive side). `registerMachineSubstitutes` below registers both,
 * deterministically, with no human in the loop:
 *
 * - `'approval/request'` (waterfall, dsh-user-approval index.d.ts:24):
 *   always resolves `'allowed-once'` — the gauntlet's whole point is judging
 *   whether the model can finish the task unattended, not exercising the
 *   approval UI, so every gate opens.
 * - `ctx.userQuestions.registerProvider` (dsh-user-questions index.d.ts:46):
 *   answers each question via {@link mapMachineAnswer} — a plan-review
 *   question (`intent.kind === 'plan-review'`) always picks the option named
 *   by `intent.approve` (never blocks on a plan review); any other question
 *   with `options` picks `options[0]`; an option-less question answers the
 *   literal string `'yes'`. This is the exact mapping this task's brief
 *   specifies inline, factored into a pure, directly unit-tested function.
 *
 * Both registrations happen synchronously in `apply()`, before `run()`'s
 * async body ever awaits the loader — so neither seam can be asked before
 * its machine answerer is composed.
 * @module @zealagent/dsh-zeal/gauntlet-runner
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import carries the cmdline Context merge for the `appExit` host
// value (mirrors headless's own import; `@deepseek-ai/cordis-plugin-loader`
// is NOT a dependency of this package, so `ctx.get('loader')` below stays
// untyped — the same convention `tui/driver.ts` already uses).
import type {} from '@deepseek-ai/dsh-cmdline'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'

/** Stable Cordis plugin name — matches the overlay's `id: zeal-gauntlet-runner` row, mirroring `zeal-startup`/`zeal-tui`'s own name/id convention. */
export const name = 'zeal-gauntlet-runner'

/**
 * Core services required before the one-shot turn can start. `userQuestions`
 * is injected (not just optionally `ctx.get`) because `apply()` dot-accesses
 * `ctx.userQuestions.registerProvider` directly — the same reason
 * `tui/index.ts` injects it.
 */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'userQuestions']

/** Plugin config: the task text, sourced from the overlay's `ZEAL_TASK` env passthrough. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface GauntletIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: GauntletIo['stdout']; stderr: GauntletIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: GauntletIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Wall-clock bound for the unattended task turn, in ms. A gauntlet run has
 * no human to notice a hung `whenIdle()` (a model looping on tool calls, a
 * wedged provider connection), and `gauntlet/run.sh` applies no timeout of
 * its own — so the runner bounds the turn itself. Overridable via
 * `ZEAL_GAUNTLET_TIMEOUT_MS` for slow tasks or fast CI probes.
 */
export const DEFAULT_TURN_TIMEOUT_MS = 20 * 60_000

/** Resolve the effective turn timeout: `ZEAL_GAUNTLET_TIMEOUT_MS` when set to a positive number, else {@link DEFAULT_TURN_TIMEOUT_MS}. */
export function turnTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env['ZEAL_GAUNTLET_TIMEOUT_MS']
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TURN_TIMEOUT_MS
}

/**
 * Race `promise` against a wall-clock deadline. Resolves `'done'` when the
 * promise settles first, `'timeout'` otherwise. The timer is unref'd so it
 * never holds the process open past a normal exit.
 */
function withDeadline(promise: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve('timeout') }, ms)
    timer.unref?.()
    promise.then(
      () => { clearTimeout(timer); resolve('done') },
      () => { clearTimeout(timer); resolve('done') },
    )
  })
}

/**
 * Pure: pick the machine's deterministic answer for one question. Exported
 * for direct unit testing (this task's required TDD target).
 *
 * - A plan-review question (`intent.kind === 'plan-review'`) always picks
 *   the option NAMED by `intent.approve` — never positional, matching the
 *   seam's own contract (`AskUserQuestionIntent.approve`'s doc: "Named
 *   rather than positional so no UI infers the verdict from option order").
 * - Any other question with `options` picks `options[0]`.
 * - An option-less question answers the literal string `'yes'`.
 * @param question - one upstream question item.
 * @returns the machine's single-selection answer for it.
 */
export function mapMachineAnswer(question: AskUserQuestionItem): AskUserQuestionAnswerItem {
  const selected = question.intent?.kind === 'plan-review'
    ? question.intent.approve
    : question.options?.[0]?.label ?? 'yes'
  return { id: question.id, selected: [selected] }
}

/**
 * Pure: map a full `AskUserQuestionRequest` into the seam's answer batch via
 * {@link mapMachineAnswer}. Exported for direct unit testing.
 * @param request - the seam's question batch.
 * @returns the machine's answer batch, one entry per question in request order.
 */
export function mapMachineAnswers(request: AskUserQuestionRequest): AskUserQuestionAnswer {
  return { answers: request.questions.map(mapMachineAnswer) }
}

/**
 * Register the gauntlet's two machine-driven answerer substitutes on `ctx`
 * (spec A11+D1). Call once per bundle context, before any turn starts — see
 * the module doc for why `apply()` calls this synchronously ahead of
 * `run()`'s async body.
 * @param ctx - the bundle's root context (carries the `'approval/request'`
 *   event and `ctx.userQuestions`).
 */
export function registerMachineSubstitutes(ctx: Context): void {
  // Always grants, never calls `next` — this IS the terminal answerer for a
  // gauntlet run (same "one terminal answerer per deployment" framing
  // `tui/answerers.ts`'s module doc documents for the interactive side).
  ctx.on('approval/request', (_req: ApprovalRequest, _next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> =>
    Promise.resolve('allowed-once'))

  ctx.userQuestions.registerProvider({
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      return Promise.resolve(mapMachineAnswers(request))
    },
  })
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * Identical shape to headless's own `run()` — see the module doc.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param task - one-shot task text.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, task: string, io: GauntletIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  // The task turn is the unbounded, model-driven part — bound it (see
  // DEFAULT_TURN_TIMEOUT_MS). On timeout, still flush what the session
  // recorded so the hung run is debuggable, then exit failing.
  const idle = agent.whenIdle()
  const timeoutMs = turnTimeoutMs()
  if (await withDeadline(idle, timeoutMs) === 'timeout') {
    io.stderr.write(`dsh: gauntlet task did not go idle within ${timeoutMs}ms — aborting the run\n`)
    await sessions.flush(agent.session)
    io.exit(1)
    return
  }
  // `withDeadline` reports 'done' for a rejection too; re-await so a real
  // failure propagates to `apply`'s catch → `fail` instead of being dropped.
  await idle
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the gauntlet's one-shot direct driver: register the machine
 * substitutes, then kick off the run.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency (mirrors headless).
  // Checked FIRST, before registering anything: a mount that's going to fail
  // should fail loud and do no other work (mirrors headless's own ordering).
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('zeal-gauntlet-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  registerMachineSubstitutes(ctx)
  const io: GauntletIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config.task, io).catch((error: unknown) => { fail(io, error) })
}

/**
 * The Zeal TUI's root component: composes `Transcript`/`InteractionPanel`/
 * `InputEditor`/`StatusBar` over one `ZealStore`, routes submitted lines to
 * either the driver (ordinary chat turn) or the `CommandDispatcher` (a
 * `/`-prefixed line), and owns the two pieces of state no lower component
 * can: global keyboard shortcuts (Esc, double-Ctrl+C) and the `/resume`
 * session picker.
 *
 * PROPS CORRECTION against this task's brief sketch (`{ store: ZealStore;
 * driver: ZealDriver; dispatcher: CommandDispatcher; onQuit(): void }`):
 *
 *   - `driver` is typed as the structural `AppDriver` below, not the
 *     concrete `ZealDriver` class. `ZealDriver`'s constructor is PRIVATE
 *     (`driver.ts`: "Construct with the static `start` factory... never
 *     directly"), and a class with private members can only be satisfied by
 *     an actual instance of that class — never by a plain object literal —
 *     so a literal `driver: ZealDriver` prop type would force every frame
 *     test to stand up a real `ZealDriver.start(...)` call (a full fake
 *     `ctx.agents`/`ctx.agentDefaultModel`, mirroring `tests/driver.test.ts`)
 *     just to test submit-routing. `AppDriver` names exactly the four
 *     methods this component calls (`send`/`interrupt`/`switchModel`/
 *     `listSessions`); a real `ZealDriver` instance structurally satisfies
 *     it with zero adaptation (narrowing a real object to a smaller
 *     structural type is always sound), while tests construct a plain fake.
 *     Same pattern `commands.ts`'s `CommandSeam` already established for
 *     `ctx.commands`.
 *   - `dispatcher: CommandDispatcher` is unchanged — `CommandDispatcher`'s
 *     constructor is public (`new CommandDispatcher({ seam, agent, locals
 *     })`), so tests construct real instances directly, exactly like
 *     `tests/commands.test.ts` does. No structural stand-in needed.
 *   - `onResume(sessionId): Promise<{ driver; dispatcher }>` is an ADDED
 *     prop the brief's terse sketch didn't spell out but its own prose
 *     requires: "`/resume` → render picker … selection restarts the driver
 *     via a callback prop". Restarting means disposing the retiring
 *     `ZealDriver` (carry-forward 3's `dispose()`) and calling
 *     `ZealDriver.start` again with `{ resumeSessionId }` — both of which
 *     need `ctx`, which only `index.ts` (the plugin `apply()`) has. This
 *     component cannot own that; it only owns the picker UI and the local
 *     `driver`/`dispatcher` state slots the swap lands in. A fresh
 *     `CommandDispatcher` comes back alongside the fresh driver because the
 *     dispatcher's local commands (`/model` in particular) close over the
 *     driver they operate on — reusing the old dispatcher after a resume
 *     would silently operate on the disposed driver.
 *
 * Submit routing (per the brief): a `/`-prefixed line either matches one of
 * the four driver-local commands (`/model`, `/resume`, `/help`, `/quit` —
 * `commands.ts`'s module doc) or falls through to `dispatcher.dispatch()`,
 * which itself checks locals before the `ctx.commands` seam. `/resume` is
 * the one local command this component intercepts BEFORE dispatch, for the
 * same reason `onResume` is a separate prop: opening the picker is
 * rendering React UI, something a `LocalCommand.run(): Promise<string |
 * undefined>` has no channel to do. `/model`/`/quit`/`/help` need no
 * App-level interception — `index.ts` builds their `LocalCommand.run()`
 * bodies closing directly over the driver/quit-callback they act on, so they
 * flow through `dispatcher.dispatch()` like any other command and their
 * `uiText` renders as an ordinary notice.
 *
 * Slash-command autocomplete hint (I6a, final-review fix wave): while the
 * current input buffer starts with `/`, a dim one-line hint renders directly
 * below the editor listing up to 6 matching command names from `dispatcher.
 * completions(currentLine)` — DISPLAY ONLY, no tab-cycling or selection (spec
 * §3.4's "slash-command autocomplete menu" is explicitly narrowed to this in
 * §8's amendment; see that file). `currentLine` is tracked via `InputEditor`'s
 * `onChange` prop (its own module doc explains why a plain `useEffect` there,
 * not `onSubmit`, is the right signal for this).
 *
 * Interaction-pending / picker-open editor inertness (carry-forward 1):
 * `InputEditor` stays MOUNTED the whole time (never conditionally
 * unmounted) so a partially-typed draft survives an approval prompt that
 * interrupts mid-type. It is made inert two ways at once, per the
 * carry-forward's "use it (isActive) and/or conditional mounting": `isActive`
 * stops its `useInput`/`usePaste` listeners from consuming keystrokes, and a
 * wrapping `<Box display="none">` (Ink 7's yoga-backed `display` prop) hides
 * it from the rendered frame without unmounting it — `display: none` alone
 * would NOT stop its keyboard listeners (Ink's `useInput` isActive is the
 * only thing that does), which is why both are used together.
 *
 * REVIEW FIX ROUND (post-Task 14 review): two additional hardenings beyond
 * the original assembly. IMPORTANT 4 — `dispatcher.dispatch(line)` can
 * reject (a throwing seam command), so `handleSubmit`'s dispatch branch now
 * carries a `.catch` that renders the failure as an error notice instead of
 * leaving an unhandled promise rejection. IMPORTANT 5 — `performResume` is
 * guarded against re-entry with a `ref` (not just `resuming` state, which
 * batches and would not catch a same-tick double-call — see its own comment
 * below), and `editorInert`/the Esc handler both extend to the WHOLE resume
 * await window, not just while the picker is visibly open, so neither a
 * submitted line nor an Esc-triggered `interrupt()` can reach the driver
 * reference while it is mid-swap/mid-dispose.
 * @module @zealagent/dsh-zeal/tui/ui/App
 */
import { Box, Text, useInput, useWindowSize } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useSyncExternalStore } from 'react'
import type { CommandDispatcher } from '../commands.ts'
import type { PickerRow } from '../driver.ts'
import type { ApprovalDecision, QuestionAnswer, StatusModel } from '../model.ts'
import type { ZealStore } from '../store.ts'
import { InputEditor } from './InputEditor.tsx'
import { InteractionPanel } from './InteractionPanel.tsx'
import { StatusBar } from './StatusBar.tsx'
import { Transcript } from './Transcript.tsx'

/** How long a second Ctrl+C has to land, after the first, to quit (per the brief). */
const CTRL_C_QUIT_WINDOW_MS = 1500
/** Shown in the status line's `retry` segment (see the module doc's field-reuse note) after the first Ctrl+C. */
const CTRL_C_HINT = 'press ctrl+c again to quit'
/** Fallback width when the host terminal reports none (matches `Transcript`/`StatusBar`'s own `Math.max(1, …)` guards). */
const DEFAULT_WIDTH = 80
/** Cap on how many matching command names the autocomplete hint line shows at once (I6a). */
const AUTOCOMPLETE_MAX = 6

/**
 * Structural subset of `ZealDriver` (`driver.ts`) this component calls. See
 * the module doc's "PROPS CORRECTION" for why this is structural rather than
 * the concrete class.
 */
export interface AppDriver {
  send(text: string): void
  interrupt(): void
  switchModel(model: string, provider?: string): void
  listSessions(limit?: number): Promise<PickerRow[]>
}

export interface AppProps {
  store: ZealStore
  driver: AppDriver
  dispatcher: CommandDispatcher
  onQuit(): void
  /** Restart the driver on a `/resume` picker selection (or `/resume <id>`); see the module doc. */
  onResume(sessionId: string): Promise<{ driver: AppDriver; dispatcher: CommandDispatcher }>
}

/** Local-only UI state for the `/resume` picker — not store-driven, unlike `state.interaction`. */
interface PickerState {
  rows: PickerRow[]
}

/** Render a thrown value's message, or its `String()` form for a non-Error throw. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Split a `/`-prefixed line into its lowercase command name and trimmed remainder — mirrors `commands.ts`'s internal `splitCommandLine`, duplicated here (not exported) because this component needs to recognize `/resume` BEFORE dispatch, not after. */
function parseCommandLine(line: string): { name: string; rest: string } {
  const body = line.slice(1)
  const spaceIdx = body.search(/\s/)
  if (spaceIdx === -1) return { name: body.toLowerCase(), rest: '' }
  return { name: body.slice(0, spaceIdx).toLowerCase(), rest: body.slice(spaceIdx).trim() }
}

export function App(props: AppProps): JSX.Element {
  const { store, onQuit, onResume } = props

  const subscribe = useMemo(() => store.subscribe.bind(store), [store])
  const getSnapshot = useMemo(() => store.getState.bind(store), [store])
  const state = useSyncExternalStore(subscribe, getSnapshot)

  const [driver, setDriver] = useState<AppDriver>(props.driver)
  const [dispatcher, setDispatcher] = useState<CommandDispatcher>(props.dispatcher)
  const [picker, setPicker] = useState<PickerState | undefined>(undefined)
  const [ctrlCHint, setCtrlCHint] = useState(false)
  // I6a: the uncommitted input buffer, mirrored from `InputEditor`'s
  // `onChange` — drives the autocomplete hint line below the editor.
  const [currentLine, setCurrentLine] = useState('')
  // Mirrors `resumingRef` below for rendering (editor inertness, `<Box
  // display>`) — see IMPORTANT 5's fix note on why the ref, not this state,
  // is the actual re-entry guard.
  const [resuming, setResuming] = useState(false)

  const lastCtrlCAtRef = useRef<number | undefined>(undefined)
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (ctrlCTimerRef.current !== undefined) clearTimeout(ctrlCTimerRef.current)
  }, [])

  // IMPORTANT 5 fix: the SYNCHRONOUS re-entry guard for `performResume`.
  // `resuming` (React state) is NOT enough on its own — React batches state
  // updates, so two `onSelect`/`handleSubmit` calls landing in the same
  // synchronous tick (e.g. a same-tick keystroke burst selecting two picker
  // rows before React has a chance to re-render and unmount the picker,
  // exactly the "Same-tick bursts" hazard `InputEditor.tsx`'s module doc
  // documents for a different component) would both see the PRE-update
  // `resuming === false` and both proceed. A `ref` is read/written
  // synchronously with no batching, so the second call in a same-tick burst
  // correctly observes the first call's guard.
  const resumingRef = useRef(false)

  const { columns } = useWindowSize()
  const width = Math.max(1, columns || DEFAULT_WIDTH)

  // IMPORTANT 5 fix: inert (not just hidden) for the ENTIRE resume await,
  // not only while the picker is visibly open — otherwise a line typed and
  // submitted during the `onResume` await could still reach `driver.send()`
  // on the OLD driver right as (or after) `index.ts` disposes it.
  const editorInert = state.interaction !== undefined || picker !== undefined || resuming

  async function performResume(sessionId: string): Promise<void> {
    if (resumingRef.current) return // a resume is already in flight — ignore
    resumingRef.current = true
    setResuming(true)
    setPicker(undefined)
    try {
      const next = await onResume(sessionId)
      setDriver(next.driver)
      setDispatcher(next.dispatcher)
      store.addNotice('info', `Resumed session ${sessionId}.`)
    } catch (err) {
      // Carry-forward 5: a resume rejection (e.g. `/resume <bad-id>`) must
      // render as an error notice, never crash the TUI.
      store.addNotice('error', `Failed to resume session ${sessionId}: ${errorText(err)}`)
    } finally {
      resumingRef.current = false
      setResuming(false)
    }
  }

  async function openResumePicker(): Promise<void> {
    if (resumingRef.current) return // don't open a picker mid-restart
    try {
      const rows = await driver.listSessions()
      setPicker({ rows })
    } catch (err) {
      store.addNotice('error', `Failed to list sessions: ${errorText(err)}`)
    }
  }

  function handleSubmit(line: string): void {
    if (line.length === 0) return
    if (dispatcher.isCommand(line)) {
      const { name, rest } = parseCommandLine(line)
      if (name === 'resume') {
        if (rest.length > 0) void performResume(rest)
        else void openResumePicker()
        return
      }
      // IMPORTANT 4 fix: `dispatch()` can reject (a throwing seam command,
      // e.g. `ctx.commands.execute` itself throwing) — without a `.catch`
      // here that becomes an unhandled promise rejection, which crashes the
      // process rather than surfacing as a normal in-TUI error.
      dispatcher.dispatch(line).then((outcome) => {
        if (outcome.uiText !== undefined) store.addNotice('info', outcome.uiText)
        else if (!outcome.handled) store.addNotice('error', `Unknown command: ${line}`)
      }).catch((err: unknown) => {
        store.addNotice('error', `Command failed: ${errorText(err)}`)
      })
      return
    }
    driver.send(line)
  }

  function handleResolve(id: number, result: ApprovalDecision | QuestionAnswer[]): void {
    store.resolveInteraction(id, result)
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      const now = Date.now()
      if (lastCtrlCAtRef.current !== undefined && now - lastCtrlCAtRef.current <= CTRL_C_QUIT_WINDOW_MS) {
        onQuit()
        return
      }
      lastCtrlCAtRef.current = now
      setCtrlCHint(true)
      if (ctrlCTimerRef.current !== undefined) clearTimeout(ctrlCTimerRef.current)
      ctrlCTimerRef.current = setTimeout(() => {
        setCtrlCHint(false)
        lastCtrlCAtRef.current = undefined
      }, CTRL_C_QUIT_WINDOW_MS)
      return
    }
    if (key.escape) {
      // IMPORTANT 5 fix: never call `driver.interrupt()` on a driver that
      // may be mid-dispose (the resume await window) — the OLD driver
      // reference is still what `driver` holds until the swap lands.
      if (resuming) return
      if (picker !== undefined) {
        setPicker(undefined)
        return
      }
      driver.interrupt()
    }
  })

  // Field reuse (documented): the double-Ctrl+C hint rides `StatusModel`'s
  // existing `retry` segment instead of adding a new field to a model/component
  // outside this task's file list. It only ever displaces a genuine in-flight
  // retry message for the ~1.5s hint window, which is an acceptable v1
  // trade-off over widening `StatusBar`.
  const displayStatus: StatusModel = ctrlCHint ? { ...state.status, retry: CTRL_C_HINT } : state.status

  // I6a: up to AUTOCOMPLETE_MAX matching command names, display only — no
  // tab-cycling or selection (see the module doc comment).
  const completions = currentLine.startsWith('/') ? dispatcher.completions(currentLine).slice(0, AUTOCOMPLETE_MAX) : []

  return (
    <Box flexDirection="column">
      <Transcript state={state} width={width} />
      {state.interaction !== undefined && (
        <InteractionPanel interaction={state.interaction} onResolve={handleResolve} />
      )}
      {state.interaction === undefined && picker !== undefined && (
        <ResumePicker
          rows={picker.rows}
          onSelect={(sessionId) => void performResume(sessionId)}
          onCancel={() => setPicker(undefined)}
        />
      )}
      <Box display={editorInert ? 'none' : 'flex'} flexDirection="column">
        <InputEditor onSubmit={handleSubmit} onChange={setCurrentLine} isActive={!editorInert} />
        {completions.length > 0 && <Text dimColor>{completions.join('  ')}</Text>}
      </Box>
      <StatusBar status={displayStatus} width={width} />
    </Box>
  )
}

/** The `/resume` picker: numbered/arrow-navigable session list, Enter confirms, App's global Esc handler cancels (see its `useInput`). */
function ResumePicker(props: {
  rows: PickerRow[]
  onSelect: (sessionId: string) => void
  onCancel: () => void
}): JSX.Element {
  const { rows, onSelect } = props
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (rows.length === 0) return
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(rows.length - 1, c + 1))
      return
    }
    if (key.return) {
      const row = rows[cursor]
      if (row) onSelect(row.sessionId)
      return
    }
    // Coalesced multi-char chunk handling — see `InteractionPanel.tsx`'s
    // module doc for why a plain `Number(input)` on the whole chunk is
    // unsafe: Ink merges consecutive plain bytes read in one `stdin` chunk
    // into a single `input` string.
    for (const char of input) {
      const digit = Number(char)
      if (Number.isInteger(digit) && digit >= 1 && digit <= rows.length) {
        const row = rows[digit - 1]
        if (row) {
          onSelect(row.sessionId)
          return
        }
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Resume session</Text>
      {rows.length === 0 && <Text dimColor>No sessions found.</Text>}
      {rows.map((row, index) => (
        <Text key={row.sessionId}>
          {`${index === cursor ? '› ' : '  '}[${index + 1}] ${row.title ?? row.sessionId}${row.live ? ' (live)' : ''}`}
        </Text>
      ))}
      <Text dimColor>up/down or number selects · enter confirms · esc cancels</Text>
    </Box>
  )
}

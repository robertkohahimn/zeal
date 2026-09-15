/**
 * Pure reducer for the multiline input editor — the A6 v1 boundary lives
 * here in full: multiline entry is reachable ONLY via the explicit
 * `newline` action (bound in `ui/InputEditor.tsx` to alt+enter / ctrl+j —
 * never inferred from a raw byte the terminal happens to send), bracketed
 * paste is unwrapped by `stripPasteMarkers` before its payload ever reaches
 * `insert`, and `history-prev`/`history-next` provide linear input-history
 * recall. IME composition guarantees remain out of scope (spec review A6).
 *
 * v2 additions: (a) an Emacs-style kill-ring — `kill-line` (bound to
 * ctrl+k) kills from the cursor to end of line, and at end of line kills the
 * newline itself (joining rows, exactly C-k's Emacs behavior, so repeated
 * kills accumulate one multi-line ring entry); consecutive kills APPEND to
 * the newest entry until any other action breaks the run. `yank` (ctrl+y)
 * re-inserts the newest entry at the cursor, `yank-pop` (alt+y) replaces the
 * just-yanked span with the next-older entry, wrapping. The ring (capacity
 * 10, newest first) survives `submit` — kill in one prompt, yank in the
 * next; all sequence-progress state (append run, rotation index, yank span)
 * is dropped by every other action, mirroring Emacs's "any other command
 * ends the kill sequence". (b) a `complete` action replacing the whole
 * buffer with a slash-command completion — the editing half of the Tab
 * cycling `ui/InputEditor.tsx` layers on top; the CANDIDATE list itself is
 * a caller concern (the App-supplied `getCompletions` prop), kept out of
 * this pure core.
 *
 * Zero dependency on Ink/React by design: every behavior above is
 * unit-tested here without a terminal (`tests/editor.test.ts`). The Ink
 * wrapper (`ui/InputEditor.tsx`) only translates `useInput` events into the
 * `EditorAction`s below — it never encodes editing policy itself.
 *
 * Draft-restore bookkeeping: the documented `EditorState` shape (`lines`,
 * `row`, `col`, `history`, `historyCursor`) is exactly this task's brief
 * contract. Restoring the in-progress draft when `history-next` navigates
 * past the newest history entry (required by the brief) needs somewhere to
 * park that draft while the buffer is showing a history entry instead —
 * this module adds one internal-only optional field, `draftLines`, purely
 * for that bookkeeping. It is written/read only by `editorReduce` below and
 * every documented field keeps its exact documented meaning; nothing
 * outside this module needs to know `draftLines` exists.
 *
 * History-navigation exit policy: any content-mutating action (`insert`,
 * `backspace`, `delete-word`, `newline`) while browsing history drops
 * `historyCursor`/`draftLines` and adopts the edited buffer as the new live
 * draft — mirroring how most shells stop tracking "which history entry am I
 * looking at" the moment you diverge from it by typing. Pure cursor moves
 * (`left`/`right`/`up`/`down`/`home`/`end`) never touch navigation state.
 * @module @zealagent/dsh-zeal/tui/editor
 */

export interface EditorState {
  lines: string[]
  row: number
  col: number
  history: string[]
  historyCursor?: number
  /** Internal bookkeeping only — see module doc comment. */
  draftLines?: string[]
  /**
   * Internal bookkeeping only (v2 kill-ring): the kill ring, newest entry
   * first, capped at {@link KILL_RING_MAX} entries. Deliberately survives
   * `submit`; nothing outside `killLine`/`yank`/`yankPop` below reads or
   * writes it.
   */
  killRing?: string[]
  /** Internal: which ring entry the last yank/yank-pop pulled — absent means the newest (index 0). */
  killIndex?: number
  /** Internal: true while the PREVIOUS action was `kill-line`, so consecutive kills append to the newest entry (Emacs semantics). */
  killAppendNext?: boolean
  /**
   * Internal: the buffer span the last yank inserted — as start/end cursor
   * positions, so it may cross rows for multi-line entries — which `yank-pop`
   * replaces in place; cleared by every other action.
   */
  yankSpan?: { startRow: number; startCol: number; endRow: number; endCol: number }
}

export type EditorAction =
  | { type: 'insert'; text: string } // printable input incl. paste payloads
  | { type: 'backspace' }
  | { type: 'delete-word' }
  | { type: 'newline' } // bound to alt+enter / ctrl+j ONLY (spec A6)
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'history-prev' }
  | { type: 'history-next' }
  | { type: 'kill-line' } // bound to ctrl+k — kill cursor→EOL (at EOL, the newline)
  | { type: 'yank' } // bound to ctrl+y — insert the newest kill
  | { type: 'yank-pop' } // bound to alt+y — replace the last yank with the next-older kill
  | { type: 'complete'; text: string } // slash-command Tab completion — replaces the whole buffer
  | { type: 'submit' } // returns text via reduce result

export interface ReduceResult {
  state: EditorState
  submitted?: string
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** Strips bracketed-paste start/end markers from anywhere in `input`. */
export function stripPasteMarkers(input: string): string {
  return input.split(PASTE_START).join('').split(PASTE_END).join('')
}

export function emptyEditor(history?: string[]): EditorState {
  return { lines: [''], row: 0, col: 0, history: history ? [...history] : [] }
}

export function editorReduce(state: EditorState, action: EditorAction): ReduceResult {
  switch (action.type) {
    case 'insert':
      return { state: breakKillSequence(insertText(state, action.text)) }
    case 'backspace':
      return { state: breakKillSequence(backspace(state)) }
    case 'delete-word':
      return { state: breakKillSequence(deleteWord(state)) }
    case 'newline':
      return { state: breakKillSequence(insertText(state, '\n')) }
    case 'left':
      return { state: breakKillSequence(moveLeft(state)) }
    case 'right':
      return { state: breakKillSequence(moveRight(state)) }
    case 'up':
      return { state: breakKillSequence(moveUp(state)) }
    case 'down':
      return { state: breakKillSequence(moveDown(state)) }
    case 'home':
      return { state: breakKillSequence({ ...state, col: 0 }) }
    case 'end':
      return { state: breakKillSequence({ ...state, col: currentLine(state).length }) }
    case 'history-prev':
      return { state: breakKillSequence(historyPrev(state)) }
    case 'history-next':
      return { state: breakKillSequence(historyNext(state)) }
    case 'kill-line':
      return { state: killLine(state) }
    case 'yank':
      return { state: yank(state) }
    case 'yank-pop':
      return { state: yankPop(state) }
    case 'complete':
      return { state: complete(state, action.text) }
    case 'submit':
      return submit(state)
    default:
      return assertNever(action)
  }
}

function assertNever(x: never): never {
  throw new Error(`editorReduce: unreachable action ${JSON.stringify(x)}`)
}

function currentLine(state: EditorState): string {
  return state.lines[state.row]
}

/** Drops history-navigation bookkeeping once the buffer has been edited — see module doc comment. */
function exitHistoryNav(state: EditorState): EditorState {
  if (state.historyCursor === undefined) return state
  const { historyCursor: _historyCursor, draftLines: _draftLines, ...rest } = state
  return rest
}

/**
 * Ends any in-progress kill/yank sequence (Emacs: any command outside the
 * kill/yank family closes a consecutive-kill append run and invalidates the
 * last yank's replaceable span). Object-identity-preserving when no sequence
 * was live, so no-op actions on sequence-free states still return the exact
 * same object — the dispatch layer's render-bailout fast path relies on it.
 */
function breakKillSequence(state: EditorState): EditorState {
  if (state.killIndex === undefined && !state.killAppendNext && state.yankSpan === undefined) return state
  const { killIndex: _killIndex, killAppendNext: _killAppendNext, yankSpan: _yankSpan, ...rest } = state
  return rest
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function insertText(state: EditorState, rawText: string): EditorState {
  const text = normalizeNewlines(rawText)
  if (text.length === 0) return state

  const line = currentLine(state)
  const left = line.slice(0, state.col)
  const right = line.slice(state.col)
  const parts = text.split('\n')
  const before = state.lines.slice(0, state.row)
  const after = state.lines.slice(state.row + 1)

  if (parts.length === 1) {
    const newLine = left + parts[0] + right
    return exitHistoryNav({
      ...state,
      lines: [...before, newLine, ...after],
      col: left.length + parts[0].length,
    })
  }

  const firstLine = left + parts[0]
  const lastPart = parts[parts.length - 1]
  const lastLine = lastPart + right
  const middle = parts.slice(1, -1)
  return exitHistoryNav({
    ...state,
    lines: [...before, firstLine, ...middle, lastLine, ...after],
    row: state.row + parts.length - 1,
    col: lastPart.length,
  })
}

function backspace(state: EditorState): EditorState {
  if (state.col > 0) {
    const line = currentLine(state)
    const newLine = line.slice(0, state.col - 1) + line.slice(state.col)
    const lines = [...state.lines]
    lines[state.row] = newLine
    return exitHistoryNav({ ...state, lines, col: state.col - 1 })
  }
  if (state.row > 0) {
    const prevLine = state.lines[state.row - 1]
    const joined = prevLine + currentLine(state)
    const lines = [...state.lines.slice(0, state.row - 1), joined, ...state.lines.slice(state.row + 1)]
    return exitHistoryNav({ ...state, lines, row: state.row - 1, col: prevLine.length })
  }
  return state
}

/** Deletes the run of non-whitespace (plus any whitespace directly before it) preceding the cursor, within the current line only — never crosses line boundaries (the v2 kill-ring lives in `killLine` below, with its own boundary rules). */
function deleteWord(state: EditorState): EditorState {
  if (state.col === 0) return state
  const line = currentLine(state)
  const left = line.slice(0, state.col)
  const trimmed = left.replace(/\s+$/, '')
  const newLeft = trimmed.replace(/\S+$/, '')
  const lines = [...state.lines]
  lines[state.row] = newLeft + line.slice(state.col)
  return exitHistoryNav({ ...state, lines, col: newLeft.length })
}

function moveLeft(state: EditorState): EditorState {
  if (state.col > 0) return { ...state, col: state.col - 1 }
  if (state.row > 0) {
    const prevLen = state.lines[state.row - 1].length
    return { ...state, row: state.row - 1, col: prevLen }
  }
  return state
}

function moveRight(state: EditorState): EditorState {
  const line = currentLine(state)
  if (state.col < line.length) return { ...state, col: state.col + 1 }
  if (state.row < state.lines.length - 1) return { ...state, row: state.row + 1, col: 0 }
  return state
}

function moveUp(state: EditorState): EditorState {
  if (state.row === 0) return state
  const targetRow = state.row - 1
  return { ...state, row: targetRow, col: Math.min(state.col, state.lines[targetRow].length) }
}

function moveDown(state: EditorState): EditorState {
  if (state.row >= state.lines.length - 1) return state
  const targetRow = state.row + 1
  return { ...state, row: targetRow, col: Math.min(state.col, state.lines[targetRow].length) }
}

function linesFromEntry(entry: string): string[] {
  const lines = entry.split('\n')
  return lines.length > 0 ? lines : ['']
}

function cursorAtEnd(lines: string[]): { row: number; col: number } {
  const row = lines.length - 1
  return { row, col: lines[row].length }
}

function historyPrev(state: EditorState): EditorState {
  if (state.history.length === 0) return state
  if (state.historyCursor === undefined) {
    const targetIndex = state.history.length - 1
    const lines = linesFromEntry(state.history[targetIndex])
    return { ...state, lines, ...cursorAtEnd(lines), historyCursor: targetIndex, draftLines: state.lines }
  }
  if (state.historyCursor === 0) return state
  const targetIndex = state.historyCursor - 1
  const lines = linesFromEntry(state.history[targetIndex])
  return { ...state, lines, ...cursorAtEnd(lines), historyCursor: targetIndex }
}

function historyNext(state: EditorState): EditorState {
  if (state.historyCursor === undefined) return state
  if (state.historyCursor < state.history.length - 1) {
    const targetIndex = state.historyCursor + 1
    const lines = linesFromEntry(state.history[targetIndex])
    return { ...state, lines, ...cursorAtEnd(lines), historyCursor: targetIndex }
  }
  // At the newest entry — one more `history-next` restores the pre-navigation draft.
  const draft = state.draftLines ?? ['']
  const { historyCursor: _historyCursor, draftLines: _draftLines, ...rest } = state
  return { ...rest, lines: draft, ...cursorAtEnd(draft) }
}

/** Kill-ring capacity — beyond this many entries the oldest fall off the end. */
const KILL_RING_MAX = 10

/**
 * `kill-line`: kills from the cursor to end of the current row; AT end of row
 * kills the newline itself (joining the row to its successor — exactly C-k's
 * Emacs behavior, and what lets repeated kills accumulate one multi-line ring
 * entry); at end of the LAST row there is nothing left to kill and the state
 * returns unchanged. Consecutive kills append to the newest ring entry while
 * `killAppendNext` holds; any other action clears it (`breakKillSequence`).
 */
function killLine(state: EditorState): EditorState {
  const line = currentLine(state)
  let killed: string
  let lines: string[]
  if (state.col < line.length) {
    killed = line.slice(state.col)
    lines = [...state.lines]
    lines[state.row] = line.slice(0, state.col)
  } else if (state.row < state.lines.length - 1) {
    killed = '\n'
    lines = [
      ...state.lines.slice(0, state.row),
      line + state.lines[state.row + 1]!,
      ...state.lines.slice(state.row + 2),
    ]
  } else {
    return state
  }
  const prevRing = state.killRing ?? []
  const ring =
    state.killAppendNext && prevRing.length > 0
      ? [prevRing[0]! + killed, ...prevRing.slice(1)]
      : [killed, ...prevRing].slice(0, KILL_RING_MAX)
  // A fresh kill supersedes (and invalidates) any prior yank span; the append
  // run flag is (re)armed for a possible consecutive kill.
  const { yankSpan: _yankSpan, ...base } = state
  return exitHistoryNav({ ...base, lines, killRing: ring, killIndex: 0, killAppendNext: true })
}

/**
 * `yank`: inserts the NEWEST ring entry at the cursor (Emacs C-y always yanks
 * the head — the rotation pointer only advances via `yank-pop`). The span the
 * yank occupies is exactly the range between the pre-insert cursor and the
 * post-insert cursor: `insertText` already spliced any embedded newlines into
 * real rows and left the cursor at the inserted text's end, so the span is
 * correct for single- AND multi-line entries alike.
 */
function yank(state: EditorState): EditorState {
  const ring = state.killRing
  if (ring === undefined || ring.length === 0) return state
  const { killAppendNext: _killAppendNext, killIndex: _killIndex, yankSpan: _yankSpan, ...base } = state
  const inserted = insertText(base, ring[0]!)
  return {
    ...inserted,
    killIndex: 0,
    yankSpan: { startRow: state.row, startCol: state.col, endRow: inserted.row, endCol: inserted.col },
  }
}

/**
 * `yank-pop`: replaces the span the last `yank` (or `yank-pop`) inserted with
 * the next-older ring entry, wrapping back to the newest after the oldest. A
 * no-op without a live span (never yanked, or any other action intervened).
 *
 * The span may cross rows (a multi-line yank), and the rotated-to entry may
 * itself contain newlines — the replacement splices `replacement.split('\n')`
 * into real rows exactly like `insertText` does, rather than embedding `\n`
 * inside a single `lines` element (which would silently corrupt the row model
 * and every col arithmetic built on it). Ring entries cannot contain `\r`:
 * every producer path (`insertText`, the `newline` action) normalizes CR away
 * before text ever lands in the buffer.
 */
function yankPop(state: EditorState): EditorState {
  const ring = state.killRing
  const span = state.yankSpan
  if (ring === undefined || ring.length === 0 || span === undefined) return state
  if (span.endRow >= state.lines.length) return state
  const nextIndex = ((state.killIndex ?? 0) + 1) % ring.length
  const replacement = ring[nextIndex]!
  const parts = replacement.split('\n')
  const left = state.lines[span.startRow]!.slice(0, span.startCol)
  const right = state.lines[span.endRow]!.slice(span.endCol)
  const spliced =
    parts.length === 1
      ? [left + parts[0]! + right]
      : [left + parts[0]!, ...parts.slice(1, -1), parts[parts.length - 1]! + right]
  const lines = [...state.lines.slice(0, span.startRow), ...spliced, ...state.lines.slice(span.endRow + 1)]
  // Cursor lands at the replacement's true end: the last spliced row's
  // replacement boundary (before any `right` remainder spliced after it).
  const endRow = span.startRow + spliced.length - 1
  const endCol = parts.length === 1 ? span.startCol + parts[0]!.length : parts[parts.length - 1]!.length
  const { killAppendNext: _killAppendNext, ...base } = state
  return {
    ...base,
    lines,
    row: endRow,
    col: endCol,
    killIndex: nextIndex,
    yankSpan: { startRow: span.startRow, startCol: span.startCol, endRow, endCol },
  }
}

/**
 * `complete`: replaces the WHOLE buffer with `text` (a `/name` completion
 * chosen by the caller's candidate list), cursor at its end. A content
 * mutation in every respect — exits history navigation and ends any kill/yank
 * sequence. Splitting on `\n` keeps it total even though command names never
 * contain one.
 */
function complete(state: EditorState, text: string): EditorState {
  const { killAppendNext: _killAppendNext, killIndex: _killIndex, yankSpan: _yankSpan, ...base } = state
  const parts = normalizeNewlines(text).split('\n')
  const lines = parts.length > 0 ? parts : ['']
  return exitHistoryNav({ ...base, lines, ...cursorAtEnd(lines) })
}

function submit(state: EditorState): ReduceResult {
  const joined = state.lines.join('\n')
  const trimmed = joined.endsWith('\n') ? joined.slice(0, -1) : joined
  // A bare Enter on an empty buffer still submits (App ignores the empty
  // line) but must not park '' in history, where up/down navigation would
  // later walk blank entries.
  const history = trimmed === '' ? [...state.history] : [...state.history, trimmed]
  const fresh = emptyEditor(history)
  // The kill ring deliberately SURVIVES a submit — killing in one prompt and
  // yanking in the next is the ring's whole point (Emacs keeps it across
  // minibuffer reads too). All sequence-progress state (append run, rotation
  // index, yank span) dies with the buffer, enforced by construction: the
  // fresh state carries none of it.
  const next: EditorState = state.killRing === undefined ? fresh : { ...fresh, killRing: state.killRing }
  return { state: next, submitted: trimmed }
}

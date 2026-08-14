/**
 * Pure reducer for the multiline input editor — the A6 v1 boundary lives
 * here in full: multiline entry is reachable ONLY via the explicit
 * `newline` action (bound in `ui/InputEditor.tsx` to alt+enter / ctrl+j —
 * never inferred from a raw byte the terminal happens to send), bracketed
 * paste is unwrapped by `stripPasteMarkers` before its payload ever reaches
 * `insert`, and `history-prev`/`history-next` provide linear input-history
 * recall. IME composition guarantees and a kill-ring are explicitly out of
 * v1 scope (spec review A6) and this module implements neither.
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
      return { state: insertText(state, action.text) }
    case 'backspace':
      return { state: backspace(state) }
    case 'delete-word':
      return { state: deleteWord(state) }
    case 'newline':
      return { state: insertText(state, '\n') }
    case 'left':
      return { state: moveLeft(state) }
    case 'right':
      return { state: moveRight(state) }
    case 'up':
      return { state: moveUp(state) }
    case 'down':
      return { state: moveDown(state) }
    case 'home':
      return { state: { ...state, col: 0 } }
    case 'end':
      return { state: { ...state, col: currentLine(state).length } }
    case 'history-prev':
      return { state: historyPrev(state) }
    case 'history-next':
      return { state: historyNext(state) }
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

/** Deletes the run of non-whitespace (plus any whitespace directly before it) preceding the cursor, within the current line only — no kill-ring, no crossing line boundaries (out of v1 scope). */
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

function submit(state: EditorState): ReduceResult {
  const joined = state.lines.join('\n')
  const trimmed = joined.endsWith('\n') ? joined.slice(0, -1) : joined
  const history = [...state.history, trimmed]
  return { state: emptyEditor(history), submitted: trimmed }
}

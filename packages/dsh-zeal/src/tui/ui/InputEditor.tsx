/**
 * Thin `useInput` → `EditorAction` mapping over the pure reducer in
 * `../editor.ts` — all editing policy (the A6 v1 boundary: multiline only
 * via an explicit keybinding, bracketed-paste unwrapping, history recall;
 * no IME guarantees, no kill-ring) lives there and is unit-tested without
 * Ink. This component only decides WHICH action a keypress maps to.
 *
 * Key → action mapping:
 * - `return` (bare `\r`, `key.return && !key.meta`) → `submit`.
 * - `alt+return` (macOS/most terminals send meta+return as `\x1b\r`, which
 *   Ink's parser reports as `key.return && key.meta`) → `newline`.
 * - `ctrl+j` → `newline`. Terminals cannot send a Ctrl+J signal distinct
 *   from a bare linefeed byte (0x0A) — `parseKeypress` special-cases
 *   `s === '\n'` before it ever reaches its generic ctrl+letter branch, so
 *   Ink reports it as plain `input === '\n'` with every `key.*` flag false.
 *   Treating a lone `'\n'` this way IS the explicit ctrl+j keybinding from
 *   spec A6, not auto-detection: real Enter keys send `\r` in raw mode (see
 *   the Ink-level test below), and an actual pasted `\n` arrives through the
 *   multi-char paste branch below, never through this single-char path.
 * - arrows: `left`/`right` always move the cursor. `up`/`down` move the
 *   cursor within multiline content UNLESS the cursor is already at the
 *   start of the buffer (row 0, col 0 — for `up`) or the end of the buffer
 *   (last row, end of that row's text — for `down`), in which case they
 *   dispatch `history-prev`/`history-next` instead (per this task's brief).
 *   That decision needs the current cursor position, which only this
 *   component's closure over `state` has — the reducer's own `up`/`down`
 *   handling is pure cursor movement and never touches history.
 * - `home`/`end` → `home`/`end`.
 * - `ctrl+w` → `delete-word`.
 * - `backspace` → `backspace`. The forward-delete key (`key.delete`, a
 *   distinct VT sequence from backspace) has no corresponding action in the
 *   v1 `EditorAction` union and is intentionally a no-op here.
 * - anything else single-character and non-modified → `insert`.
 *
 * Multi-char chunk handling (the coalesced-chunk lesson from Task 9's
 * `InteractionPanel`, commit 69eeda5): Ink's `useInput` coalesces
 * consecutive plain bytes read in one `stdin` chunk into a single `input`
 * string. A fast typist, an SSH burst, or a genuine terminal paste all
 * produce a multi-char `input` — and per Ink's own doc comment on
 * `useInput`, "if the user pastes text and it's more than one character,
 * the callback will be called only once, and the whole string will be
 * passed as `input`." After `stripPasteMarkers` removes any bracketed-paste
 * framing (`\x1b[200~`/`\x1b[201~`), a chunk longer than one character is
 * therefore treated as a single `insert` (the reducer normalizes any
 * embedded CRLF/CR to `\n` and splices multi-line paste content across
 * rows) rather than walked key-by-key — unlike `InteractionPanel`'s
 * hotkey-driven views, free text entry is exactly where a multi-char chunk
 * is expected and desired, so there is no per-character hotkey table to
 * misfire here in the first place. Trade-off accepted for v1: if a control
 * byte such as ctrl+w's 0x17 ever lands fused into the same multi-char
 * terminal-read chunk as ordinary text (rather than as its own discrete
 * keystroke — the paste/fast-typing case this branch targets), it is
 * inserted as a literal character instead of triggering `delete-word`; a
 * standalone ctrl+w keystroke is unaffected and hits the dedicated branch
 * below.
 *
 * Deliberately `useState`, not `useReducer`: React requires the function
 * passed to `useReducer` to be pure (Strict Mode double-invokes it in
 * development specifically to catch side effects), but `submit` must fire
 * `props.onSubmit` exactly once per keystroke. Calling it from inside a
 * `useReducer` reducer would risk a double-submit under Strict Mode: `state`
 * is instead plain component state, and `editorReduce` is invoked directly,
 * synchronously, inside the `useInput` event handler below (an ordinary
 * event callback, not a pure render-phase function), where calling
 * `onSubmit` as a side effect is safe.
 * @module @zealagent/dsh-zeal/tui/ui/InputEditor
 */
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { JSX } from 'react'
import { editorReduce, emptyEditor, stripPasteMarkers } from '../editor.ts'
import type { EditorAction, EditorState } from '../editor.ts'

export interface InputEditorProps {
  /** Called once, synchronously, with the submitted text whenever `return` (and not `alt+return`) is pressed. */
  onSubmit: (text: string) => void
  /** Optional seed history (e.g. restored from a prior session), oldest first. */
  history?: string[]
  /**
   * Set to `false` to stop this component from consuming keyboard input
   * without unmounting it — e.g. while `InteractionPanel` is showing a
   * pending approval/question, per Task 14's layout. Defaults to `true`.
   */
  isActive?: boolean
}

export function InputEditor(props: InputEditorProps): JSX.Element {
  const { onSubmit, history, isActive = true } = props
  const [state, setState] = useState<EditorState>(() => emptyEditor(history))

  const dispatch = (action: EditorAction): void => {
    const result = editorReduce(state, action)
    setState(result.state)
    if (result.submitted !== undefined) onSubmit(result.submitted)
  }

  useInput(
    (rawInput, key) => {
      const stripped = stripPasteMarkers(rawInput)

      // Multi-char chunk: paste/burst — see module doc comment.
      if (stripped.length > 1) {
        dispatch({ type: 'insert', text: stripped })
        return
      }

      if (key.return && key.meta) {
        dispatch({ type: 'newline' })
        return
      }
      if (key.return) {
        dispatch({ type: 'submit' })
        return
      }
      // ctrl+j — see module doc comment for why this is a bare '\n'.
      if (!key.ctrl && !key.meta && stripped === '\n') {
        dispatch({ type: 'newline' })
        return
      }
      if (key.leftArrow) {
        dispatch({ type: 'left' })
        return
      }
      if (key.rightArrow) {
        dispatch({ type: 'right' })
        return
      }
      if (key.upArrow) {
        dispatch(state.row === 0 && state.col === 0 ? { type: 'history-prev' } : { type: 'up' })
        return
      }
      if (key.downArrow) {
        const lastRow = state.lines.length - 1
        const atEnd = state.row === lastRow && state.col === state.lines[lastRow].length
        dispatch(atEnd ? { type: 'history-next' } : { type: 'down' })
        return
      }
      if (key.home) {
        dispatch({ type: 'home' })
        return
      }
      if (key.end) {
        dispatch({ type: 'end' })
        return
      }
      if (key.ctrl && stripped === 'w') {
        dispatch({ type: 'delete-word' })
        return
      }
      if (key.backspace) {
        dispatch({ type: 'backspace' })
        return
      }
      if (stripped.length === 1 && !key.ctrl && !key.meta) {
        dispatch({ type: 'insert', text: stripped })
      }
    },
    { isActive },
  )

  // Line rendering is intentionally plain (a `> ` prompt marker on the first
  // row, indented continuation rows) with no synthesized cursor glyph — v1
  // scope is the editing model, not a custom cursor renderer; the terminal's
  // own cursor still tracks the underlying raw-mode input.
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {state.lines.map((line, index) => (
        <Text key={index}>{index === 0 ? `> ${line}` : `  ${line}`}</Text>
      ))}
      <Text dimColor>enter submits · alt+enter/ctrl+j newline · up/down history · ctrl+w delete word</Text>
    </Box>
  )
}

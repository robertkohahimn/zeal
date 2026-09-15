/**
 * Thin `useInput`/`usePaste` → `EditorAction` mapping over the pure reducer
 * in `../editor.ts` — all editing policy (the A6 v1 boundary: multiline
 * only via an explicit keybinding, bracketed-paste unwrapping, history
 * recall; plus the v2 kill-ring and Tab-completion buffer replacement; no
 * IME guarantees) lives there and is unit-tested without Ink. This
 * component only decides WHICH action a keypress maps to.
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
 *   the Ink-level test below), and genuine pasted content is intercepted
 *   entirely on the separate `usePaste` channel below — it never reaches
 *   this single-char classifier at all (see "Paste handling").
 * - `tab`/`shift+tab` → slash-command completion cycling (v2) — see the
 *   "Tab completion" section below. Ink reports both with `key.tab` (bare
 *   `\t`, and `\x1b[Z` for shift+tab, whose CSI `[Z` final byte its parser
 *   additionally flags `shift`) and `input === ''` (`tab` is in Ink's
 *   `nonAlphanumericKeys`, so its text is suppressed), which is also why
 *   Tab previously fell through the insert branch as a silent no-op.
 * - `ctrl+k` → `kill-line`, `ctrl+y` → `yank`, `alt+y` → `yank-pop` (v2
 *   kill-ring; the reducer owns all the semantics, this layer only maps).
 * - arrows: `left`/`right` always move the cursor. `up`/`down` move the
 *   cursor within multiline content UNLESS the cursor is already at the
 *   start of the buffer (row 0, col 0 — for `up`) or the end of the buffer
 *   (last row, end of that row's text — for `down`), in which case they
 *   dispatch `history-prev`/`history-next` instead (per this task's brief).
 *   That decision needs the current cursor position — see "Same-tick bursts"
 *   below for why it's resolved from the reducer's own state, not a
 *   render-closure variable.
 * - `home`/`end` → `home`/`end`.
 * - `ctrl+w` → `delete-word`.
 * - `backspace` → `backspace`. The forward-delete key (`key.delete`, a
 *   distinct VT sequence from backspace) has no corresponding action in the
 *   v1 `EditorAction` union and is intentionally a no-op here.
 * - anything else single-character and non-modified → `insert`.
 *
 * Tab completion (v2, supersedes I6a's display-only hint): when a
 * `getCompletions` prop is supplied and the buffer starts with `/`, Tab
 * cycles forward through the candidate list (Shift+Tab backward), REPLACING
 * the buffer with the selected candidate via the reducer's `complete`
 * action; a unique FRESH match completes with a trailing space, ready for
 * the command's argument (shell convention). The candidate list is anchored
 * to the prefix the cycling STARTED from — without the anchor, the first
 * Tab's buffer replacement would shrink `getCompletions(buffer)` down to
 * just the selected candidate and kill the cycle. Any other editor action
 * (typing, deleting, history, submit, cursor moves) re-anchors by clearing
 * the anchor, exactly like the shell. The dim candidate hint line renders
 * HERE (inside the editor border), not in `App` — the selection state that
 * highlights the active candidate is component-local. Tab outside a `/`
 * line, or with no matching candidates, is a deliberate no-op (v1 already
 * never inserted a literal tab: Ink suppresses tab's text, so the insert
 * branch's `length === 1` guard never saw it).
 *
 * Paste handling (fix round 1 finding 1): Ink 7.1's own `input-parser.js`
 * already recognizes bracketed-paste framing (`\x1b[200~…\x1b[201~`) and, by
 * default — when nothing has registered a dedicated `'paste'` listener —
 * silently re-injects the unwrapped content through the SAME channel as
 * ordinary keystrokes (`useInput`'s `input`), stripped of markers but with
 * NO indication it was pasted. A paste whose content is exactly `\r` (or
 * happens to coincide with any other single-byte special-key sequence) then
 * gets classified by `useInput`'s per-key parser exactly like that key
 * being pressed — `key.return` in the `\r` case — which previously caused a
 * pasted `\r` to trigger a premature `submit` and drop the rest of the
 * paste instead of being inserted. Registering `usePaste` below fixes this
 * at the source rather than papering over it: per Ink's own doc comment,
 * "`usePaste` and `useInput` can be used together… paste content is never
 * forwarded to `useInput` handlers when `usePaste` is active" — genuine
 * paste content now arrives on its own channel and is dispatched straight
 * to `insert` (through `stripPasteMarkers` for defense-in-depth and the
 * reducer's own CRLF/CR→`\n` normalization), never re-entering the keypress
 * classifier above at all. `usePaste` also switches the terminal into
 * bracketed-paste mode for as long as this component is active, which is
 * what makes the paste content arrive framed in the first place.
 *
 * Multi-char `useInput` chunk handling (the coalesced-chunk lesson from
 * Task 9's `InteractionPanel`, commit 69eeda5) is kept as a SEPARATE
 * fallback alongside `usePaste`, not replaced by it: Ink's `useInput`
 * coalesces consecutive plain bytes read in one `stdin` chunk into a single
 * `input` string regardless of `usePaste` — a fast typist or an SSH burst
 * (not bracket-framed at all) still lands here as one multi-char `input`,
 * and a terminal that doesn't honor bracketed-paste mode would too. After
 * `stripPasteMarkers` (defense-in-depth — see above), a chunk longer than
 * one character is treated as a single `insert` (the reducer splices any
 * embedded newlines across rows), except that trailing `\r`s dispatch
 * `submit` — a typing burst most often ends with the Enter that sent it,
 * and inserting that `\r` as a draft row would swallow the submission (see
 * the inline comment in the handler for the interior-`\r` trade-off) —
 * rather than walked key-by-key — unlike
 * `InteractionPanel`'s hotkey-driven views, free text entry is exactly
 * where a multi-char chunk is expected and desired. Trade-off accepted for
 * v1: if a control byte such as ctrl+w's 0x17 (or tab's 0x09, which Ink's
 * parser equally does not split out of a text segment) ever lands fused
 * into the same multi-char terminal-read chunk as ordinary text (rather
 * than as its own discrete keystroke), it is inserted as a literal
 * character instead of triggering `delete-word`/completion; standalone
 * ctrl+w or Tab keystrokes are unaffected.
 *
 * Same-tick bursts (fix round 1 finding 2): the very first version of this
 * component computed `editorReduce(state, action)` against `state` closed
 * over from the render that registered the `useInput` callback, then called
 * `setState(result.state)` with a plain value. `useInput`'s handler is a
 * `useEffectEvent`, which only refreshes its closure after a commit (see
 * `tests/ui/interaction.test.tsx`'s doc comment) — so several keystrokes
 * arriving in the same synchronous burst (key repeat, or several distinct
 * `stdin` reads processed back-to-back before React flushes) each reduced
 * from the SAME stale `state`, and only the last `setState` call survived:
 * dropped keystrokes, and — because the up/down history-vs-cursor routing
 * decision (row 0/col 0 for up, last row/end for down) also read that same
 * stale `state` — a possible misroute into history navigation mid-burst.
 * Fixed by moving BOTH the reduce and the up/down routing decision inside a
 * `setState` FUNCTIONAL updater, computed from the updater's own `prev`
 * argument: React threads `prev` through every queued update in a batch in
 * order, so each keystroke in a burst sees the correctly-updated state left
 * by the one before it, not a single stale snapshot.
 *
 * That functional-updater requirement collides with the ORIGINAL reason
 * this component used `useState` instead of `useReducer` in the first
 * place: `submit`'s `onSubmit` side effect must fire exactly once, but
 * React Strict Mode double-invokes both `useReducer` reducers AND `useState`
 * functional updaters in development specifically to catch impurities — so
 * naively calling `onSubmit` from inside the updater below would risk
 * double-firing it for one keystroke. Resolved by keeping the updater pure:
 * it appends any submitted text to a `submittedLog: string[]` array that is
 * itself part of the committed state (so both Strict Mode invocations,
 * given the identical `prev`, compute the identical appended array — only
 * one is kept as the real state either way) rather than mutating anything
 * external. A `useEffect` — which, unlike a reducer/updater, is NOT
 * double-invoked on ordinary updates in Strict Mode, only simulated as an
 * extra mount/cleanup/mount cycle on the very first mount — drains any
 * unflushed entries of `submittedLog` (tracked via a `flushedCountRef`
 * cursor) after each commit and calls `onSubmit` for each in order. This
 * also correctly handles the (rare) case of two genuine submits landing in
 * the same batch: both are queued and flushed in order, none dropped or
 * duplicated.
 *
 * `onChange` (I6a, final-review fix wave): reports the full current buffer
 * (`editor.lines.join('\n')`) after every commit via a plain dependency-array
 * `useEffect` — NOT from inside the `dispatch` updater, which the "Same-tick
 * bursts" section above documents must stay pure (Strict Mode double-invokes
 * it). `App.tsx` uses this to drive the slash-command autocomplete hint line:
 * it needs to see uncommitted, still-being-typed text (`dispatcher.
 * completions(currentLine)`), which `onSubmit` alone — firing only once a
 * line is actually submitted — cannot provide.
 * @module @zealagent/dsh-zeal/tui/ui/InputEditor
 */
import { Box, Text, useInput, usePaste } from 'ink'
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { editorReduce, emptyEditor, stripPasteMarkers } from '../editor.ts'
import type { EditorAction, EditorState } from '../editor.ts'

export interface InputEditorProps {
  /** Called once per submitted line, in order, whenever `return` (and not `alt+return`) is pressed. */
  onSubmit: (text: string) => void
  /**
   * Called with the full current buffer (`lines.join('\n')`) after every
   * commit where it changed — including the initial mount, with whatever
   * `history`-seeded or empty value that starts as. See the module doc
   * comment ("`onChange`") for why `App.tsx` needs this in addition to
   * `onSubmit`.
   */
  onChange?: (text: string) => void
  /**
   * Slash-command completion source (v2): returns the `/name` candidates for
   * the given input line, caller-sorted and caller-capped. When supplied and
   * the buffer starts with `/`, Tab cycles forward through the candidates
   * (Shift+Tab backward) replacing the buffer with the selection — see the
   * module doc's "Tab completion" section. MUST be pure: it is invoked
   * inside state updaters, which React Strict Mode double-invokes in
   * development, and at render time for the hint line.
   */
  getCompletions?: (line: string) => string[]
  /** Optional seed history (e.g. restored from a prior session), oldest first. */
  history?: string[]
  /**
   * Set to `false` to stop this component from consuming keyboard input
   * without unmounting it — e.g. while `InteractionPanel` is showing a
   * pending approval/question, per Task 14's layout. Defaults to `true`.
   */
  isActive?: boolean
}

/** Component-local wrapper state: the pure editor state plus an append-only log of submitted texts awaiting flush — see module doc comment ("Same-tick bursts"). */
interface UiState {
  editor: EditorState
  submittedLog: string[]
  /**
   * The anchored Tab-completion session, if any: the prefix cycling started
   * from plus the currently selected candidate index into
   * `getCompletions(prefix)`. Part of committed state (not a ref) so
   * same-tick Tab bursts thread through ordered functional updates, exactly
   * like every other keystroke — and cleared by any non-Tab action.
   */
  completion?: { prefix: string; index: number }
}

function initialUiState(history?: string[]): UiState {
  return { editor: emptyEditor(history), submittedLog: [] }
}

/** Either a concrete action, or a resolver that computes one from the freshest editor state at update time — used by up/down (see module doc comment). */
type DispatchInput = EditorAction | ((prev: EditorState) => EditorAction)

export function InputEditor(props: InputEditorProps): JSX.Element {
  const { onSubmit, onChange, history, isActive = true, getCompletions } = props
  const [ui, setUi] = useState<UiState>(() => initialUiState(history))
  const flushedCountRef = useRef(0)

  // I6a: report the current buffer to `onChange` after every commit where it
  // changed — see the module doc comment ("`onChange`") for why this is a
  // plain effect rather than a call from inside the `dispatch` updater above.
  const currentText = ui.editor.lines.join('\n')
  useEffect(() => {
    onChange?.(currentText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentText])

  const dispatch = (input: DispatchInput): void => {
    setUi((prev) => {
      const action = typeof input === 'function' ? input(prev.editor) : input
      const result = editorReduce(prev.editor, action)
      if (result.submitted === undefined) {
        if (result.state === prev.editor && prev.completion === undefined) return prev
        // Any editor action other than Tab-cycling re-anchors completion:
        // the buffer changed shape, so the old prefix's candidate list is
        // stale (see the module doc's "Tab completion" section).
        const { completion: _completion, ...rest } = prev
        return { ...rest, editor: result.state }
      }
      const { completion: _completion, ...rest } = prev
      return { ...rest, editor: result.state, submittedLog: [...prev.submittedLog, result.submitted] }
    })
  }

  /**
   * Tab/Shift+Tab (v2): compute the anchored candidate list and replace the
   * buffer with the next selection. Lives inside the functional updater for
   * the same reason every other keystroke does ("Same-tick bursts"): the
   * buffer and anchor are read from `prev`, never a render closure.
   * `getCompletions` must be pure (it runs inside the updater, which
   * Strict Mode double-invokes) — the App-supplied `dispatcher.completions`
   * is.
   */
  const cycleCompletion = (backward: boolean): void => {
    setUi((prev) => {
      if (getCompletions === undefined) return prev
      const buffer = prev.editor.lines.join('\n')
      if (!buffer.startsWith('/')) return prev
      const anchored =
        prev.completion !== undefined &&
        buffer.toLowerCase().startsWith(prev.completion.prefix.toLowerCase())
      // NB: the condition is restated inline (not via `anchored`) so the true
      // branch's `prev.completion` is narrowed to non-undefined for TS.
      const anchor =
        prev.completion !== undefined && buffer.toLowerCase().startsWith(prev.completion.prefix.toLowerCase())
          ? prev.completion
          : { prefix: buffer, index: -1 }
      const candidates = getCompletions(anchor.prefix)
      if (candidates.length === 0) return prev
      const index = anchored
        ? (anchor.index + (backward ? -1 : 1) + candidates.length) % candidates.length
        : backward
          ? candidates.length - 1
          : 0
      const selected = candidates[index]!
      // Shell convention: a unique FRESH match completes with a trailing
      // space so the cursor lands ready for the command's argument. Once
      // cycling has begun the raw candidate is used, so repeated Tab on a
      // single candidate never accumulates spaces.
      const text = candidates.length === 1 && anchor.index === -1 ? `${selected} ` : selected
      const result = editorReduce(prev.editor, { type: 'complete', text })
      return { ...prev, editor: result.state, completion: { prefix: anchor.prefix, index } }
    })
  }

  // Flushes any submissions the updater(s) above appended since the last
  // commit this effect saw. Deliberately unguarded by a dependency array —
  // it re-checks `flushedCountRef` on every commit, which is cheap and
  // avoids a stale-closure dependency bug; the ref cursor makes it a no-op
  // on commits with nothing new to flush.
  useEffect(() => {
    while (flushedCountRef.current < ui.submittedLog.length) {
      onSubmit(ui.submittedLog[flushedCountRef.current])
      flushedCountRef.current += 1
    }
  })

  // Genuine paste content — see module doc comment ("Paste handling"). Ink
  // strips the bracketed-paste framing before this handler ever sees it;
  // `stripPasteMarkers` is defense-in-depth in case marker bytes are ever
  // embedded in the payload itself, and the reducer normalizes CRLF/CR.
  usePaste(
    (text) => {
      dispatch({ type: 'insert', text: stripPasteMarkers(text) })
    },
    { isActive },
  )

  useInput(
    (rawInput, key) => {
      const stripped = stripPasteMarkers(rawInput)

      // Multi-char chunk: fast-typing/SSH burst, or a terminal that doesn't
      // honor bracketed-paste mode — see module doc comment. Enter is the
      // one key a typing burst most often ends with (`hello\r` typed fast
      // enough to coalesce), so trailing `\r`s are honored as the submit
      // keypresses they are rather than inserted as draft rows. Interior
      // `\r`s stay inserts: mid-chunk they far more likely delimit lines of
      // non-bracketed pasted content, where a premature submit would fire
      // the half-typed line as a prompt (the exact bug the `usePaste`
      // channel fixes for bracketed pastes).
      if (stripped.length > 1) {
        const trailingReturns = /\r+$/.exec(stripped)?.[0].length ?? 0
        const body = trailingReturns > 0 ? stripped.slice(0, -trailingReturns) : stripped
        if (body !== '') dispatch({ type: 'insert', text: body })
        for (let i = 0; i < trailingReturns; i++) dispatch({ type: 'submit' })
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
      // Tab / Shift+Tab — slash-command completion cycling (v2). Input is ''
      // here (Ink suppresses tab's text), so there is no insert branch to
      // shadow; outside a `/` line or with no candidates this is a no-op.
      if (key.tab) {
        cycleCompletion(key.shift === true)
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
        dispatch((prev) => (prev.row === 0 && prev.col === 0 ? { type: 'history-prev' } : { type: 'up' }))
        return
      }
      if (key.downArrow) {
        dispatch((prev) => {
          const lastRow = prev.lines.length - 1
          const atEnd = prev.row === lastRow && prev.col === prev.lines[lastRow].length
          return atEnd ? { type: 'history-next' } : { type: 'down' }
        })
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
      // v2 kill-ring bindings — semantics live entirely in the reducer
      // (`editor.ts`'s killLine/yank/yankPop); this layer only maps bytes.
      if (key.ctrl && stripped === 'k') {
        dispatch({ type: 'kill-line' })
        return
      }
      if (key.ctrl && stripped === 'y') {
        dispatch({ type: 'yank' })
        return
      }
      if (key.meta && stripped === 'y') {
        dispatch({ type: 'yank-pop' })
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
  const { editor } = ui

  // v2 completion hint (moved here from App): list the candidates for the
  // ANCHORED prefix while Tab-cycling (so the list doesn't collapse to the
  // selected candidate after the first Tab), or for the raw buffer before
  // any Tab. The selected candidate renders inverse-video. Rendering inside
  // the editor border also groups the hint with the line it completes.
  const buffer = editor.lines.join('\n')
  const anchored =
    ui.completion !== undefined && buffer.toLowerCase().startsWith(ui.completion.prefix.toLowerCase())
  const hintPrefix = ui.completion !== undefined && anchored ? ui.completion.prefix : buffer
  const hintCandidates =
    getCompletions !== undefined && buffer.startsWith('/') ? getCompletions(hintPrefix) : []
  const activeIndex = ui.completion !== undefined && anchored ? ui.completion.index : -1

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {editor.lines.map((line, index) => (
        <Text key={index}>{index === 0 ? `> ${line}` : `  ${line}`}</Text>
      ))}
      {hintCandidates.length > 0 && (
        <Text dimColor>
          {hintCandidates.flatMap((candidate, index) => [
            ...(index > 0 ? ['  '] : []),
            <Text key={candidate} inverse={index === activeIndex}>
              {candidate}
            </Text>,
          ])}
        </Text>
      )}
      <Text dimColor>
        enter submits · alt+enter/ctrl+j newline · up/down history · ctrl+w delete word · ctrl+k kill ·
        ctrl+y yank · tab completes
      </Text>
    </Box>
  )
}

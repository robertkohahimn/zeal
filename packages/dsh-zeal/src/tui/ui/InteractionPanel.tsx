/**
 * Renders whatever `PendingInteraction` the store currently needs resolved
 * — an `ApprovalPrompt` (y/n) or a `QuestionsPrompt` (numbered options, one
 * item at a time, answers accumulated and handed back as `QuestionAnswer[]`
 * once the last item is submitted).
 *
 * `useInput` is called unconditionally here, which is safe by construction:
 * per this task's brief, the future `App` mounts `InteractionPanel` only
 * while `state.interaction` is set, so this component — and the raw-mode
 * keyboard listener it registers — exists only for the lifetime of a
 * pending interaction and never steals keys from the editor otherwise.
 *
 * Plan-review keybinding mapping (documented per this task's brief, since
 * `QuestionItem.options` carries no semantic tag for which option is
 * "approve" vs "request changes"): `[a]` resolves the option whose label
 * case-insensitively contains "approve", falling back to `options[0]`;
 * `[r]` resolves the option whose label contains "reject"/"deny"/
 * "decline"/"changes", falling back to the first option other than the
 * approve pick. Task 13's `mapQuestions` should supply plan-review options
 * in that order (approve first, e.g. `['Approve plan', 'Request changes']`)
 * so the label match — or the positional fallback — lines up.
 *
 * Multi-character chunk handling (fix round 1): Ink's `useInput` coalesces
 * consecutive plain (non-escape) bytes read in one `stdin` chunk into a
 * SINGLE `input` string — see `ink/build/input-parser.js`'s
 * `parseKeypresses`, which only splits out backspace bytes on their own;
 * regular characters (including an embedded `\r`/`\n`) stay merged. A fast
 * typist, an SSH burst, or a test doing `stdin.write('2\r')` in one call all
 * produce a multi-char `input`. When that happens, `parseKeypress` can't
 * populate `key.name` (its single-character equality checks don't match a
 * longer string), so every derived `key.*` flag — including `key.return` —
 * comes back `false`. Branches that did an exact `input === 'y'`-style
 * match, or that gated on `key.return`, silently no-op on the whole chunk.
 * Every non-custom-mode keyboard branch below therefore iterates `input`
 * character-by-character and re-checks each one against the same per-key
 * rules a genuine single keystroke would hit (`'\r'`/`'\n'` treated as
 * enter, since Ink's own single-char parser maps either to a submit-style
 * key). Free-text custom mode is the one place a multi-char chunk is
 * expected and desired — it's a paste — so it keeps appending `input`
 * whole; `key.return`/`key.backspace`/`key.delete` are only ever `true` for
 * genuine single-character events per the paragraph above, so a pasted
 * chunk containing an embedded newline correctly falls through to the
 * plain-append branch instead of being misread as a submit.
 * @module @zealagent/dsh-zeal/tui/ui/InteractionPanel
 */
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { JSX } from 'react'
import type {
  ApprovalDecision,
  ApprovalPrompt,
  PendingInteraction,
  QuestionAnswer,
  QuestionItem,
  QuestionOption,
  QuestionsPrompt,
} from '../model.ts'

type OnResolve = (id: number, result: ApprovalDecision | QuestionAnswer[]) => void

const APPROVE_LABEL_RE = /approve/i
const REJECT_LABEL_RE = /(reject|deny|decline|changes)/i

export function InteractionPanel(props: { interaction: PendingInteraction; onResolve: OnResolve }): JSX.Element {
  const { interaction, onResolve } = props
  if (interaction.kind === 'approval') {
    return <ApprovalView prompt={interaction} onResolve={onResolve} />
  }
  return <QuestionsView prompt={interaction} onResolve={onResolve} />
}

function ApprovalView(props: { prompt: ApprovalPrompt; onResolve: OnResolve }): JSX.Element {
  const { prompt, onResolve } = props
  useInput((input) => {
    // See the module doc comment: `input` may be a multi-char chunk (e.g.
    // 'yy' from a fast double-press, or any burst that lands in one read).
    // Walk it character-by-character and stop at the first decisive key —
    // resolving is terminal, so anything after it in the same chunk is
    // moot (the store's resolveInteraction is a no-op for a stale id, but
    // we still must not call onResolve twice from one chunk).
    for (const char of input) {
      if (char === 'y') {
        onResolve(prompt.id, 'allow-once')
        return
      }
      if (char === 'n') {
        onResolve(prompt.id, 'reject')
        return
      }
    }
  })
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{prompt.title}</Text>
      <Text>{prompt.detail}</Text>
      <Text dimColor>[y] allow once  [n] reject</Text>
    </Box>
  )
}

function QuestionsView(props: { prompt: QuestionsPrompt; onResolve: OnResolve }): JSX.Element {
  const { prompt, onResolve } = props
  const [itemIndex, setItemIndex] = useState(0)
  const [answers, setAnswers] = useState<QuestionAnswer[]>([])
  const [selected, setSelected] = useState<string[]>([])
  // The option a number key most recently targeted. Under `multiSelect`,
  // number keys move this cursor without selecting; `space` toggles
  // whichever option it points at. Under single-select, number keys select
  // directly and the cursor is cosmetic (highlights the current pick).
  const [cursor, setCursor] = useState(0)
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState('')

  const item = prompt.items[itemIndex]

  /** Records the current item's answer and either advances or resolves. */
  const submit = (answer: QuestionAnswer): void => {
    const nextAnswers = [...answers, answer]
    if (itemIndex + 1 >= prompt.items.length) {
      onResolve(prompt.id, nextAnswers)
      return
    }
    setAnswers(nextAnswers)
    setItemIndex(itemIndex + 1)
    setSelected([])
    setCursor(0)
    setCustomMode(false)
    setCustomText('')
  }

  useInput((input, key) => {
    if (!item) return

    if (customMode) {
      // A multi-char `input` here is a paste — appended whole, below.
      // `key.return`/`key.backspace`/`key.delete` are only ever `true` for
      // a genuine single-character event (see module doc comment), so a
      // pasted chunk with an embedded newline or DEL byte correctly misses
      // these and falls through to the plain-append branch instead of
      // being misread as submit/erase.
      if (key.return) {
        submit({ id: item.id, selected: [], custom: customText })
        return
      }
      if (key.backspace || key.delete) {
        setCustomText((text) => text.slice(0, -1))
        return
      }
      if (input.length > 0 && !key.ctrl && !key.meta) {
        setCustomText((text) => text + input)
      }
      return
    }

    // Outside custom mode, `input` may still be a multi-char chunk (see
    // module doc comment). Walk it character-by-character, applying the
    // same rule a lone keystroke would hit, threading `selected`/`cursor`
    // through local variables — React state set earlier in this same
    // callback hasn't committed yet, so re-reading the `selected`/`cursor`
    // closures mid-loop would see stale values for a burst like '13 \r'.
    let currentSelected = selected
    let currentCursor = cursor
    let submitted = false

    for (const char of input) {
      if (submitted) break

      if (item.planReview) {
        if (char === 'a') {
          const approve = findApproveOption(item.options)
          submit({ id: item.id, selected: approve ? [approve.label] : [] })
          submitted = true
        } else if (char === 'r') {
          const approve = findApproveOption(item.options)
          const reject = findRejectOption(item.options, approve)
          submit({ id: item.id, selected: reject ? [reject.label] : [] })
          submitted = true
        }
        continue
      }

      if (char === 'c') {
        setCustomMode(true)
        break
      }

      if (char === '\r' || char === '\n') {
        submit({ id: item.id, selected: currentSelected })
        submitted = true
        continue
      }

      if (char === ' ') {
        if (!item.multiSelect) continue
        const label = item.options[currentCursor]?.label
        if (label === undefined) continue
        currentSelected = currentSelected.includes(label)
          ? currentSelected.filter((entry) => entry !== label)
          : [...currentSelected, label]
        continue
      }

      const digit = Number(char)
      if (Number.isInteger(digit) && digit >= 1 && digit <= item.options.length) {
        const index = digit - 1
        currentCursor = index
        if (!item.multiSelect) currentSelected = [item.options[index]!.label]
      }
    }

    // `submit()` already reset selection/cursor state for the next item (or
    // resolved outright) — only flush the locally-accumulated values when
    // nothing in this chunk submitted.
    if (!submitted) {
      if (currentSelected !== selected) setSelected(currentSelected)
      if (currentCursor !== cursor) setCursor(currentCursor)
    }
  })

  if (!item) return <Box />
  if (item.planReview) return <PlanReviewView item={item} />
  return (
    <QuestionItemView item={item} selected={selected} cursor={cursor} customMode={customMode} customText={customText} />
  )
}

/** See module doc comment for the disambiguation policy this implements. */
function findApproveOption(options: readonly QuestionOption[]): QuestionOption | undefined {
  return options.find((option) => APPROVE_LABEL_RE.test(option.label)) ?? options[0]
}

/**
 * See module doc comment for the disambiguation policy this implements.
 *
 * Deliberately has NO fall-back to `approve`: when the item offers nothing
 * but the approve pick there is no way to express "reject", and returning
 * `approve` here would make `[r]` submit the approve label — a rejection
 * silently recorded as consent. The caller instead submits `selected: []`
 * (the shape `mapAnswers` documents for a skipped item), which the seam
 * reads as "no option chosen" rather than as approval.
 */
function findRejectOption(
  options: readonly QuestionOption[],
  approve: QuestionOption | undefined,
): QuestionOption | undefined {
  return (
    options.find((option) => option !== approve && REJECT_LABEL_RE.test(option.label)) ??
    options.find((option) => option !== approve)
  )
}

function PlanReviewView(props: { item: QuestionItem }): JSX.Element {
  const { item } = props
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold>PLAN REVIEW</Text>
      <Text bold>{item.question}</Text>
      {item.detail !== undefined && item.detail.length > 0 && <Text dimColor>{item.detail}</Text>}
      <Text dimColor>[a] approve plan  [r] request changes</Text>
    </Box>
  )
}

function QuestionItemView(props: {
  item: QuestionItem
  selected: string[]
  cursor: number
  customMode: boolean
  customText: string
}): JSX.Element {
  const { item, selected, cursor, customMode, customText } = props
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {item.header !== undefined && item.header.length > 0 && <Text bold>{item.header}</Text>}
      <Text bold>{item.question}</Text>
      {item.detail !== undefined && item.detail.length > 0 && <Text dimColor>{item.detail}</Text>}
      {item.options.map((option, index) => (
        <Text key={`${index}-${option.label}`}>
          {`${index === cursor ? '› ' : '  '}[${index + 1}] ${selected.includes(option.label) ? '✓ ' : ''}${option.label}`}
          {option.description !== undefined && option.description.length > 0 ? `  ${option.description}` : ''}
        </Text>
      ))}
      <Text dimColor>
        {item.multiSelect ? 'space toggles · enter submits · c custom answer' : 'enter submits · c custom answer'}
      </Text>
      {customMode && (
        <Box>
          <Text>{'> '}</Text>
          <Text>{customText}</Text>
        </Box>
      )}
    </Box>
  )
}

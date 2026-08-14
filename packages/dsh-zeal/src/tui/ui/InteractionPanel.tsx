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
    if (input === 'y') onResolve(prompt.id, 'allow-once')
    else if (input === 'n') onResolve(prompt.id, 'reject')
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

    if (item.planReview) {
      if (input === 'a') {
        const approve = findApproveOption(item.options)
        submit({ id: item.id, selected: approve ? [approve.label] : [] })
        return
      }
      if (input === 'r') {
        const approve = findApproveOption(item.options)
        const reject = findRejectOption(item.options, approve)
        submit({ id: item.id, selected: reject ? [reject.label] : [] })
        return
      }
      return
    }

    if (input === 'c') {
      setCustomMode(true)
      return
    }

    if (key.return) {
      submit({ id: item.id, selected })
      return
    }

    if (input === ' ') {
      if (!item.multiSelect) return
      const label = item.options[cursor]?.label
      if (label === undefined) return
      setSelected((current) => (current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]))
      return
    }

    const digit = Number(input)
    if (Number.isInteger(digit) && digit >= 1 && digit <= item.options.length) {
      const index = digit - 1
      setCursor(index)
      if (!item.multiSelect) setSelected([item.options[index]!.label])
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

/** See module doc comment for the disambiguation policy this implements. */
function findRejectOption(
  options: readonly QuestionOption[],
  approve: QuestionOption | undefined,
): QuestionOption | undefined {
  return (
    options.find((option) => option !== approve && REJECT_LABEL_RE.test(option.label)) ??
    options.find((option) => option !== approve) ??
    approve
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

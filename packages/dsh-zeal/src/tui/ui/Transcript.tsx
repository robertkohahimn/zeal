/**
 * Renders the full Zeal transcript: settled entries inside Ink's `<Static>`
 * region — rendered once, appended to as new items arrive, per spec §3.4
 * ("Settled entries render into Ink's `<Static>` region; only the live tail
 * re-renders") — followed by the currently streaming live turn.
 *
 * Live-turn layout (spec §3.4 + this task's brief): dim italic reasoning
 * ABOVE the streaming text, running tool calls as `ToolPanel`s with the `…`
 * spinner glyph. The live markdown pass is wrapped in `React.memo` (Task 7's
 * carry-forward note): the live tail re-renders on every coalesced store
 * tick while streaming, and `Markdown` re-lexes its source on every render,
 * so memoizing on `source`/`width` skips re-lexing ticks where the text
 * hasn't actually changed.
 * @module @zealagent/dsh-zeal/tui/ui/Transcript
 */
import { Box, Static, Text } from 'ink'
import { memo } from 'react'
import type { JSX } from 'react'
import type { AssistantEntry, LiveTurn, NoticeEntry, TranscriptEntry, UserEntry, ZealViewState } from '../model.ts'
import { Markdown } from './Markdown.tsx'
import { ToolPanel } from './ToolPanel.tsx'

const MemoMarkdown = memo(Markdown)

export function Transcript(props: { state: ZealViewState; width: number }): JSX.Element {
  const { state, width } = props
  const safeWidth = Math.max(1, width)
  return (
    <Box flexDirection="column" width={safeWidth}>
      <Static items={[...state.settled]}>
        {(entry) => <SettledEntryView key={entry.seq} entry={entry} width={safeWidth} />}
      </Static>
      {state.live && <LiveTurnView live={state.live} width={safeWidth} />}
    </Box>
  )
}

function SettledEntryView(props: { entry: TranscriptEntry; width: number }): JSX.Element {
  const { entry, width } = props
  switch (entry.kind) {
    case 'user':
      return <UserEntryView entry={entry} width={width} />
    case 'assistant':
      return <AssistantEntryView entry={entry} width={width} />
    case 'tool':
      return <ToolPanel tool={entry} width={width} />
    case 'notice':
      return <NoticeEntryView entry={entry} />
  }
}

function UserEntryView(props: { entry: UserEntry; width: number }): JSX.Element {
  const { entry, width } = props
  const contentWidth = Math.max(1, width - 2)
  return (
    <Box flexDirection="row" width={width}>
      <Text bold color="cyan">
        {'› '}
      </Text>
      <Box width={contentWidth}>
        <Text wrap="wrap">{entry.text}</Text>
      </Box>
    </Box>
  )
}

function AssistantEntryView(props: { entry: AssistantEntry; width: number }): JSX.Element {
  const { entry, width } = props
  return (
    <Box flexDirection="column" width={width}>
      {entry.reasoning.length > 0 && (
        <Box width={width}>
          <Text dimColor italic wrap="wrap">
            {entry.reasoning}
          </Text>
        </Box>
      )}
      {entry.text.length > 0 && <Markdown source={entry.text} width={width} />}
    </Box>
  )
}

function NoticeEntryView(props: { entry: NoticeEntry }): JSX.Element {
  const { entry } = props
  return (
    <Text {...(entry.level === 'error' ? { color: 'red' } : {})} dimColor={entry.level === 'info'}>
      {entry.text}
    </Text>
  )
}

function LiveTurnView(props: { live: LiveTurn; width: number }): JSX.Element {
  const { live, width } = props
  return (
    <Box flexDirection="column" width={width}>
      {live.reasoning.length > 0 && (
        <Box width={width}>
          <Text dimColor italic wrap="wrap">
            {live.reasoning}
          </Text>
        </Box>
      )}
      {live.tools.map((tool) => (
        <ToolPanel key={tool.callId} tool={tool} width={width} />
      ))}
      {live.text.length > 0 && <MemoMarkdown source={live.text} width={width} />}
    </Box>
  )
}

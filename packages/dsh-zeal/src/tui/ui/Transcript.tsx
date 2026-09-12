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
 *
 * `<Static>` child keys: NOT `entry.seq` alone. `store.ts`'s turn-end fold
 * can settle several entries (orphaned running tools, the trailing
 * assistant entry, an error/abort notice) in the same flush, stamping every
 * one of them with the same `seq` — a bare `key={entry.seq}` collides and
 * trips React's duplicate-key warning. `Static`'s render prop's second
 * argument is the absolute, collision-free index into the full items array
 * (see `ink@7.1.1`'s `Static.js`), so the key combines it with `kind`+`seq`
 * for readability while staying unique.
 *
 * `<Static key={state.generation}>` (C3, final-review fix wave): `<Static>`
 * keeps its OWN internal index into the `items` array across renders,
 * tracking how many it has already flushed to the terminal — it never
 * re-renders an item once flushed, by design (that's the whole performance
 * point). `ZealStore.reset()` (the `/resume` restart path, `store.ts`)
 * replaces `settled` with a brand-new, typically much SHORTER array (a
 * resumed session's own seed), which `<Static>` can misread as the same
 * array having merely shrunk — its stale index then points past the new
 * array's end, and the resumed session's seed silently never renders, non-
 * deterministically depending on exactly when the store's 16ms notify
 * coalescer fires relative to the reset. `state.generation` (bumped by every
 * `reset()`, see `model.ts`'s doc comment) as the `key` forces React to
 * unmount the old `<Static>` and mount a fresh one on every reset, which
 * resets that internal index to zero along with it — the new instance
 * treats the whole `settled` array as unflushed and renders it from
 * scratch, exactly the seed-replay behavior a `/resume` restart needs.
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
      <Static key={state.generation} items={[...state.settled]}>
        {(entry, index) => (
          <SettledEntryView key={`${entry.kind}-${entry.seq}-${index}`} entry={entry} width={safeWidth} />
        )}
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

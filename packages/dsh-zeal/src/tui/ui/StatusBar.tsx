/**
 * The single inverse-video status line, per this task's brief:
 * `zeal · {provider}/{model} · {title ?? 'new session'} · {running hint or
 * 'idle'} · {sandboxMode ?? ''} · {retry ?? ''} · ctx {contextFill%}`, with
 * absent optional segments (`sandboxMode`, `retry`, `contextFill`) omitted
 * entirely rather than rendered as an empty gap between separators.
 *
 * Spec rule N1 (binding): zai's catalogs price everything at 0, so any
 * derived cost figure would be confidently wrong. This line MUST NEVER
 * render a dollar/currency amount — `StatusModel` has no cost field to
 * begin with, and no segment here synthesizes one.
 * @module @zealagent/dsh-zeal/tui/ui/StatusBar
 */
import { Box, Text } from 'ink'
import type { JSX } from 'react'
import type { StatusModel } from '../model.ts'

const SEGMENT_SEPARATOR = ' · '
const RUNNING_HINT = '⏵ running (esc interrupts)'
const IDLE_HINT = 'idle'
const NEW_SESSION_LABEL = 'new session'

export function StatusBar(props: { status: StatusModel; width: number }): JSX.Element {
  const { status, width } = props
  const safeWidth = Math.max(1, width)
  const line = buildSegments(status).join(SEGMENT_SEPARATOR)
  // Pad to the full width so the inverse-video band spans the terminal,
  // matching a conventional status-bar look; `wrap="truncate"` protects
  // against a line that overruns a narrow terminal.
  const padded = line.padEnd(safeWidth, ' ')
  return (
    <Box width={safeWidth}>
      <Text inverse wrap="truncate">
        {padded}
      </Text>
    </Box>
  )
}

/** Assembles the status-line segments, omitting any whose source value is absent. */
function buildSegments(status: StatusModel): string[] {
  const segments: string[] = [
    'zeal',
    `${status.provider}/${status.model}`,
    status.title ?? NEW_SESSION_LABEL,
    status.running ? RUNNING_HINT : IDLE_HINT,
  ]
  if (status.sandboxMode) segments.push(status.sandboxMode)
  if (status.retry) segments.push(status.retry)
  if (status.contextFill !== undefined) segments.push(`ctx ${Math.round(status.contextFill * 100)}%`)
  return segments
}

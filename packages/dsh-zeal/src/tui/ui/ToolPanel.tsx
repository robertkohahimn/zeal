/**
 * Renders one `ToolEntry` (running or settled) as a single-line header —
 * `▸ name(argsPreview) — status` — plus, once settled, a capped number of
 * indented preview lines: up to 6 on `error`, 2 on `ok` (a still-`running`
 * tool has no preview yet — `store.ts` seeds it as `''`).
 *
 * Tools named `subagent`/`subagent_fork` render their preview as a nested
 * child block (deeper indent than a plain tool's preview) — per spec §3.4,
 * "subagent activity [is surfaced] under the delegating tool call", i.e.
 * through this same `ToolEntry`/`ToolPanel` seam rather than a dedicated
 * transcript entry kind.
 * @module @zealagent/dsh-zeal/tui/ui/ToolPanel
 */
import { Box, Text } from 'ink'
import type { JSX } from 'react'
import type { ToolEntry } from '../model.ts'

const RUNNING_GLYPH = '…'
const MAX_PREVIEW_LINES_ERROR = 6
const MAX_PREVIEW_LINES_OK = 2
const PLAIN_INDENT = 2
const NESTED_INDENT = 4
const ARGS_PREVIEW_MAX_CHARS = 60

export function ToolPanel(props: { tool: ToolEntry; width: number }): JSX.Element {
  const { tool, width } = props
  const safeWidth = Math.max(1, width)
  const isSubagent = tool.name === 'subagent' || tool.name === 'subagent_fork'
  const indent = isSubagent ? NESTED_INDENT : PLAIN_INDENT
  const header = `▸ ${tool.name}(${previewArgs(tool.args)}) — ${statusLabel(tool.status)}`
  const previewLines = capPreviewLines(tool)
  const contentWidth = Math.max(1, safeWidth - indent)
  const headerColor = statusColor(tool.status)

  return (
    <Box flexDirection="column" width={safeWidth}>
      <Text wrap="truncate" {...(headerColor ? { color: headerColor } : {})}>
        {header}
      </Text>
      {previewLines.length > 0 && (
        <Box flexDirection="column" marginLeft={indent} width={contentWidth}>
          {previewLines.map((line, index) => (
            <Text key={index} dimColor wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** Only a settled tool has a preview to show; the cap depends on outcome. */
function capPreviewLines(tool: ToolEntry): string[] {
  if (tool.status === 'running') return []
  const max = tool.status === 'error' ? MAX_PREVIEW_LINES_ERROR : MAX_PREVIEW_LINES_OK
  if (tool.preview.length === 0) return []
  return tool.preview.split('\n').slice(0, max)
}

function statusLabel(status: ToolEntry['status']): string {
  return status === 'running' ? RUNNING_GLYPH : status
}

function statusColor(status: ToolEntry['status']): string | undefined {
  if (status === 'error') return 'red'
  if (status === 'ok') return 'green'
  return undefined
}

/** Collapses whitespace/newlines in the raw args JSON and truncates for the header line. */
function previewArgs(args: string): string {
  const normalized = args.replace(/\s+/g, ' ').trim()
  if (normalized.length <= ARGS_PREVIEW_MAX_CHARS) return normalized
  return `${normalized.slice(0, ARGS_PREVIEW_MAX_CHARS - 1)}…`
}

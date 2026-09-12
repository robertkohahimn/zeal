/**
 * Renders a markdown string into Ink primitives (`<Box>`/`<Text>`) at a fixed
 * terminal `width`. Uses `marked`'s LEXER ONLY (`marked.lexer`) to obtain a
 * token tree — never marked's HTML renderer/output path — and walks that
 * tree directly into Ink components.
 *
 * Rendering rules (see task-7-brief.md):
 *   - headings: bold + underline
 *   - paragraphs: word-wrapped to `width` (delegated to Ink's own wrapping,
 *     which hard-breaks unbreakable tokens — see `wrap="wrap"` below)
 *   - fenced code: dim, unwrapped, each line horizontally truncated to `width`
 *   - inline code: cyan
 *   - bold / italic (/ strikethrough, bonus)
 *   - lists (ordered/unordered): `•` or `n.` marker, nested lists get an
 *     additional 2-space indent
 *   - blockquotes: `│ ` prefix on EVERY rendered line (not just the first),
 *     which requires this module to do its own word-wrapping for blockquote
 *     content (see `wrapWords`) rather than relying on Ink's per-Text wrap,
 *     since Ink has no primitive for "repeat this prefix on every wrapped
 *     line of a sibling Text".
 *
 * Every block is capped to `width`; the "no line exceeds width" invariant is
 * enforced either by Ink's native `wrap`/`truncate` behavior (paragraphs,
 * headings, list items, code lines) or by this module's own `wrapWords`
 * helper (blockquote lines, where per-line prefixing is required).
 */
import { Box, Text } from 'ink'
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'
import type { JSX, Key, ReactNode } from 'react'

export function Markdown(props: { source: string; width: number }): JSX.Element {
  const { source, width } = props
  const safeWidth = Math.max(1, width)
  const tokens = marked.lexer(source).filter((token) => token.type !== 'space')
  return (
    <Box flexDirection="column" width={safeWidth}>
      {tokens.map((token, index) => (
        <Box key={index} flexDirection="column" marginBottom={index < tokens.length - 1 ? 1 : 0}>
          {renderBlock(token, safeWidth)}
        </Box>
      ))}
    </Box>
  )
}

function renderBlock(token: Token, width: number): ReactNode {
  const safeWidth = Math.max(1, width)
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading
      return (
        <Box width={safeWidth}>
          <Text bold underline wrap="wrap">
            {renderInline(heading.tokens)}
          </Text>
        </Box>
      )
    }
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph
      return (
        <Box width={safeWidth}>
          <Text wrap="wrap">{renderInline(paragraph.tokens)}</Text>
        </Box>
      )
    }
    case 'code':
      return renderCodeBlock(token as Tokens.Code, safeWidth)
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote, safeWidth)
    case 'list':
      return renderList(token as Tokens.List, safeWidth)
    case 'table':
      return renderTable(token as Tokens.Table, safeWidth)
    case 'hr':
      return (
        <Box width={safeWidth}>
          <Text dimColor>{'─'.repeat(safeWidth)}</Text>
        </Box>
      )
    case 'space':
    case 'def':
    case 'html':
      return null
    default: {
      const fallbackText = extractPlainText(token)
      if (fallbackText.length === 0) return null
      return (
        <Box width={safeWidth}>
          <Text wrap="wrap">{fallbackText}</Text>
        </Box>
      )
    }
  }
}

// SANCTIONED CHOICE (task-7 review finding 2, controller ruling — no further
// action): fenced code is rendered `dimColor`-only (dim foreground), not a
// `backgroundColor` panel. A literal background block was judged
// terminal-theme-hostile (fights light/dark/high-contrast themes and
// arbitrary user palettes), whereas `dimColor` degrades safely everywhere.
function renderCodeBlock(token: Tokens.Code, width: number): ReactNode {
  const lines = token.text.split('\n')
  return (
    <Box flexDirection="column" width={width}>
      {lines.map((line, index) => (
        <Text key={index} dimColor wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  )
}

/**
 * Minimal readable table rendering (task-7 review finding 1): one line per
 * row, cells joined with " │ ", header line followed by a dim rule line.
 * Every line goes through Ink's native `wrap="truncate"` (same mechanism as
 * fenced code lines) so the width invariant holds without hand-rolled
 * truncation. Cell content is flattened via `flattenCellTokens` (preferring
 * each cell's parsed `.tokens` over its raw `.text`, since `.text` retains
 * unparsed markdown syntax, e.g. `**Alice**` instead of `Alice`) so styled
 * cells don't leak markup either.
 */
function renderTable(token: Tokens.Table, width: number): ReactNode {
  const headerLine = token.header.map(flattenCellTokens).join(' │ ')
  const ruleLine = '─'.repeat(width)
  const rowLines = token.rows.map((row) => row.map(flattenCellTokens).join(' │ '))
  const lines = [headerLine, ruleLine, ...rowLines]
  return (
    <Box flexDirection="column" width={width}>
      {lines.map((line, index) => (
        <Text key={index} bold={index === 0} dimColor={index === 1} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  )
}

function flattenCellTokens(cell: Tokens.TableCell): string {
  const text = flattenTokens(cell.tokens) || cell.text
  return normalizeWhitespace(text).trim()
}

function renderBlockquote(token: Tokens.Blockquote, width: number): ReactNode {
  const contentWidth = Math.max(1, width - 2)
  const lines = blockquoteLines(token, contentWidth)
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} dimColor>{`│ ${line}`}</Text>
      ))}
    </Box>
  )
}

function blockquoteLines(token: Tokens.Blockquote, contentWidth: number): string[] {
  const lines: string[] = []
  for (const child of token.tokens) {
    const text = extractPlainText(child)
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length === 0) continue
    lines.push(...wrapWords(normalized, contentWidth))
  }
  return lines.length > 0 ? lines : ['']
}

function renderList(token: Tokens.List, width: number): ReactNode {
  return (
    <Box flexDirection="column" width={width}>
      {token.items.map((item, index) => (
        <Box key={index} flexDirection="column">
          {renderListItem(item, index, token.ordered, width)}
        </Box>
      ))}
    </Box>
  )
}

function renderListItem(item: Tokens.ListItem, index: number, ordered: boolean, width: number): ReactNode {
  const marker = ordered ? `${index + 1}. ` : '• '
  const contentWidth = Math.max(1, width - marker.length)
  const { inline, nested } = splitListItemTokens(item.tokens)
  return (
    <>
      <Box flexDirection="row">
        <Text>{marker}</Text>
        <Box width={contentWidth}>
          <Text wrap="wrap">{renderInline(inline)}</Text>
        </Box>
      </Box>
      {nested.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {nested.map((nestedList, nestedIndex) => (
            <Box key={nestedIndex} flexDirection="column">
              {renderList(nestedList, Math.max(1, width - 2))}
            </Box>
          ))}
        </Box>
      )}
    </>
  )
}

function splitListItemTokens(tokens: Token[]): { inline: Token[]; nested: Tokens.List[] } {
  const inline: Token[] = []
  const nested: Tokens.List[] = []
  for (const token of tokens) {
    if (token.type === 'list') {
      nested.push(token as Tokens.List)
    } else if (token.type === 'text' || token.type === 'paragraph') {
      const withTokens = token as Tokens.Text | Tokens.Paragraph
      if (withTokens.tokens) {
        inline.push(...withTokens.tokens)
      } else {
        inline.push({ type: 'text', raw: withTokens.text, text: withTokens.text } as Tokens.Text)
      }
    } else {
      const text = extractPlainText(token)
      if (text.length > 0) inline.push({ type: 'text', raw: text, text } as Tokens.Text)
    }
  }
  return { inline, nested }
}

function renderInline(tokens: Token[] | undefined): ReactNode {
  if (!tokens || tokens.length === 0) return ''
  return tokens.map((token, index) => renderInlineToken(token, index))
}

function renderInlineToken(token: Token, key: Key): ReactNode {
  switch (token.type) {
    case 'text':
    case 'escape': {
      const t = token as Tokens.Text | Tokens.Escape
      return normalizeWhitespace(t.text ?? t.raw)
    }
    case 'strong': {
      const t = token as Tokens.Strong
      return (
        <Text key={key} bold>
          {t.tokens && t.tokens.length > 0 ? renderInline(t.tokens) : normalizeWhitespace(t.text)}
        </Text>
      )
    }
    case 'em': {
      const t = token as Tokens.Em
      return (
        <Text key={key} italic>
          {t.tokens && t.tokens.length > 0 ? renderInline(t.tokens) : normalizeWhitespace(t.text)}
        </Text>
      )
    }
    case 'del': {
      const t = token as Tokens.Del
      return (
        <Text key={key} strikethrough>
          {t.tokens && t.tokens.length > 0 ? renderInline(t.tokens) : normalizeWhitespace(t.text)}
        </Text>
      )
    }
    case 'codespan': {
      const t = token as Tokens.Codespan
      return (
        <Text key={key} color="cyan">
          {t.text}
        </Text>
      )
    }
    case 'link': {
      const t = token as Tokens.Link
      return (
        <Text key={key}>{t.tokens && t.tokens.length > 0 ? renderInline(t.tokens) : normalizeWhitespace(t.text)}</Text>
      )
    }
    case 'image': {
      const t = token as Tokens.Image
      return normalizeWhitespace(t.text || t.href)
    }
    case 'br':
      return ' '
    default:
      return normalizeWhitespace(extractPlainText(token))
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** Flattens an array of tokens (e.g. a table cell's `.tokens`) into plain text. */
function flattenTokens(tokens: Token[] | undefined): string {
  if (!tokens || tokens.length === 0) return ''
  return tokens.map(extractPlainText).join('')
}

/**
 * Recursively flattens a token's inline `tokens` (if any) into plain text.
 * This is a defensive fallback path used for out-of-scope/unhandled token
 * types (e.g. inside a blockquote or list item) — it must never fall back to
 * a token's raw markdown source for token types that have their own
 * structured content, since that would leak literal markup (e.g. a `table`
 * token's `.raw` is the pipe-delimited source text). `table` is special-cased
 * for that reason; `renderTable` is the primary (nicer) path for top-level
 * tables, this is the safety net for tables nested somewhere else.
 */
function extractPlainText(token: Token): string {
  if (token.type === 'table') {
    const t = token as Tokens.Table
    const header = t.header.map(flattenCellTokens).join(' ')
    const rows = t.rows.map((row) => row.map(flattenCellTokens).join(' ')).join(' ')
    return normalizeWhitespace(`${header} ${rows}`).trim()
  }
  const withTokens = token as { tokens?: Token[]; text?: string; raw?: string }
  if (withTokens.tokens && withTokens.tokens.length > 0) {
    return withTokens.tokens.map(extractPlainText).join('')
  }
  if (typeof withTokens.text === 'string') return withTokens.text
  if (typeof withTokens.raw === 'string') return withTokens.raw
  return ''
}

/** Greedy word-wrap of plain text to `width` columns, hard-breaking any word longer than `width`. */
function wrapWords(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width)
  const words = text.split(/\s+/).filter((word) => word.length > 0)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    for (const chunk of chunkWord(word, maxWidth)) {
      if (current.length === 0) {
        current = chunk
      } else if (current.length + 1 + chunk.length <= maxWidth) {
        current += ` ${chunk}`
      } else {
        lines.push(current)
        current = chunk
      }
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(current)
  return lines
}

/** Splits a single unbreakable word into `width`-sized chunks. */
function chunkWord(word: string, width: number): string[] {
  if (word.length <= width) return [word]
  const chunks: string[] = []
  for (let i = 0; i < word.length; i += width) chunks.push(word.slice(i, i + width))
  return chunks
}

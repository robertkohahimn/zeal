#!/usr/bin/env node
// Minimal stdio MCP server for gauntlet task G5 — exposes one tool,
// lookup_constant, that returns a fixed JSON value the model must copy into
// constant.txt. This is the spec §4.5 doc-flow rehearsal target: G5's
// setup.sh wires this exact file into the composed profile via
// `dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'zeal-gauntlet-g5', version: '0.1.0' })

server.registerTool(
  'lookup_constant',
  {
    title: 'Lookup Constant',
    description: 'Returns the ZEAL_MAGIC constant as a JSON object.',
  },
  async () => ({
    content: [
      { type: 'text', text: JSON.stringify({ ZEAL_MAGIC: 271828 }) },
    ],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)

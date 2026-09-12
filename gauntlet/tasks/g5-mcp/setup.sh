#!/usr/bin/env bash
# G5 per-task setup hook — see gauntlet/run.sh's step 4b comment for the
# calling contract (env vars, ordering). Runs after $WORKDIR already holds
# this task's repo/mcp-server.mjs, and before the task itself runs.
#
# This IS the spec §4.5 MCP doc-flow rehearsal: install the MCP-client
# plugin into the profile exactly the way a real user would (`dsh plugin
# --profile zeal add @deepseek-ai/dsh-mcp-client`, via `pnpm dlx` mirroring
# run.sh's own step 2 invocation), then wire it to this task's own
# mcp-server.mjs with a stdio transport row. The row needs $WORKDIR's
# runtime absolute path, so — unlike G7's static overlay.extra.cordis.yml —
# it cannot be written ahead of time and is appended here instead.
set -euo pipefail

echo "gauntlet/tasks/g5-mcp/setup.sh: adding @deepseek-ai/dsh-mcp-client to the zeal profile..."
DSH_HOME="$DSH_HOME" pnpm dlx "@deepseek-ai/dsh@$DSH_VERSION" plugin --profile zeal add \
  @deepseek-ai/dsh-mcp-client

# mcp-server.mjs does `import { McpServer } from '@modelcontextprotocol/sdk/...'`.
# Node's ESM resolver walks up from the IMPORTING FILE's own path (not cwd,
# and NODE_PATH has no effect on `import`), so a bare specifier only
# resolves if some ancestor of $WORKDIR/mcp-server.mjs has a node_modules
# containing the package. $WORKDIR is a fresh mktemp directory with no such
# ancestor, so give it one: this workspace's own root node_modules already
# has @modelcontextprotocol/sdk (added as a caret-range devDependency for
# exactly this reason — see package.json).
ln -sfn "$REPO_ROOT/node_modules" "$WORKDIR/node_modules"

echo "gauntlet/tasks/g5-mcp/setup.sh: appending mcp-zeal-lookup row..."
cat >> "$DSH_HOME/profiles/zeal/cordis.patch.yml" <<EOF

# Appended by gauntlet/tasks/g5-mcp/setup.sh — wires the
# @deepseek-ai/dsh-mcp-client plugin (added above) to this task's own
# repo/mcp-server.mjs by absolute path.
- insert:
    - id: mcp-zeal-lookup
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zeal-lookup
        transport: stdio
        command: node
        args: ["$WORKDIR/mcp-server.mjs"]
EOF

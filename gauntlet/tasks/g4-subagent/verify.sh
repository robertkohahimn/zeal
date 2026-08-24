#!/usr/bin/env bash
# G4 verify: (1) the repo's own vitest suite passes in the scratch workdir
# gauntlet/run.sh copied repo/ into (all three TODO-marked bugs fixed), AND
# (2) the run actually delegated to a subagent, not just fixed the bugs
# directly — grep for a `"subagent"` tool/call event (the tool-subagent
# package's model-facing tool name defaults to `subagent`; see
# $DSH_SRC/packages/subagent/tool-subagent/src/index.ts's Config doc).
#
# $WORKDIR and $DSH_HOME are set by gauntlet/run.sh before invoking this
# script. Session logs are written uncompressed and nested two levels deep
# under "$DSH_HOME/sessions" (see G3's verify.sh comment for the exact
# on-disk layout cite), so this greps recursively.
set -euo pipefail

# Resolved BEFORE the `cd` below: ${BASH_SOURCE[0]} may be a relative path,
# and `cd "$WORKDIR"` would then make it resolve against the wrong
# directory. gauntlet/run.sh happens to invoke this script by absolute
# path, but that is not something a verify script should depend on.
GAUNTLET_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../lib" && pwd)"
cd "$WORKDIR" && npx vitest run


# Structural check, NOT a substring grep: `session.jsonl` records user and
# assistant messages verbatim, so grepping it for a tool name also matches
# the task prompt and any model that merely NARRATES using the tool without
# calling it. gauntlet/lib/find-session-event.mjs parses each record and
# matches on the event's own `type`/`data` fields instead — see its module
# doc for the full rationale and the event-shape transcription.
node "$GAUNTLET_LIB/find-session-event.mjs" \
  "$DSH_HOME/sessions" 'tool/call:name=subagent'

#!/usr/bin/env bash
# G7 verify: (1) the repo's own vitest suite passes (the one failing test in
# src/pipeline.test.ts fixed) in the scratch workdir gauntlet/run.sh copied
# repo/ into, AND (2) compaction actually fired while summarizing the eight
# stage files — grep the scratch session store for a `compaction/end` event.
#
# Event type name transcribed from
# $DSH_SRC/packages/compaction/compaction-basic/src/region.ts: automatic
# compaction appends `session.append('compaction/start', lifecycle)` (line
# 189) then, on success, `session.append('compaction/end', lifecycle)`
# (line 215; a failure path also appends 'compaction/end' with an error
# field at line 223). 'compaction/end' is used here rather than
# 'compaction/start' because it only appears once a compaction cycle has
# actually completed (or been recorded as failed) — proof compaction fully
# ran, not just began.
#
# $WORKDIR and $DSH_HOME are set by gauntlet/run.sh. Session logs are
# uncompressed and nested two levels deep under "$DSH_HOME/sessions" (see
# G3's verify.sh comment for the exact on-disk layout cite), so this greps
# recursively.
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
  "$DSH_HOME/sessions" 'compaction/end'

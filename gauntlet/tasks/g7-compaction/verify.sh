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
cd "$WORKDIR" && npx vitest run

if ! grep -rq '"compaction/end"' "$DSH_HOME/sessions"; then
  echo "verify.sh: no compaction/end session event found under \$DSH_HOME/sessions" >&2
  exit 1
fi

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
cd "$WORKDIR" && npx vitest run

if ! grep -rq '"subagent"' "$DSH_HOME/sessions"; then
  echo "verify.sh: no \"subagent\" tool event found under \$DSH_HOME/sessions" >&2
  exit 1
fi

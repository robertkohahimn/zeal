#!/usr/bin/env bash
# G1 verify: the task passes iff the repo's own vitest suite passes in the
# scratch workdir gauntlet/run.sh copied repo/ into. $WORKDIR is set by
# gauntlet/run.sh before invoking this script.
set -euo pipefail
cd "$WORKDIR" && npx vitest run

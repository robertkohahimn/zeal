#!/usr/bin/env bash
# G2 verify: the task passes iff the repo's own vitest suite passes in the
# scratch workdir gauntlet/run.sh copied repo/ into. $WORKDIR is set by
# gauntlet/run.sh before invoking this script. test/api.test.ts imports the
# single unified async getUser from src/userApi.ts (which does not exist in
# the unmodified fixture), so this fails until the model creates it and
# rewires src/callers.ts to use it.
set -euo pipefail
cd "$WORKDIR" && npx vitest run

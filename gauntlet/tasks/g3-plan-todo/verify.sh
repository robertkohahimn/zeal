#!/usr/bin/env bash
# G3 verify: (1) the repo's own vitest suite passes in the scratch workdir
# gauntlet/run.sh copied repo/ into, AND (2) the run actually exercised
# todo_write (the task text starts "Plan first, then implement:", which
# should make the model plan with the todo tool before coding).
#
# $WORKDIR and $DSH_HOME are set by gauntlet/run.sh before invoking this
# script. Session logs are written uncompressed under
# "$DSH_HOME/sessions/--<normalized-cwd>--/<encoded-id>/session.jsonl" (see
# gauntlet/overlay.cordis.yml's session-persistence-jsonl override to
# compression: none, and $DSH_SRC/packages/session/session-persistence-jsonl/
# README.md's "On-disk layout" section for the exact two-level nesting) —
# grep recursively rather than assuming a flat "$DSH_HOME/sessions/*" glob.
set -euo pipefail
cd "$WORKDIR" && npx vitest run

if ! grep -rq 'todo_write' "$DSH_HOME/sessions"; then
  echo "verify.sh: no todo_write tool event found under \$DSH_HOME/sessions" >&2
  exit 1
fi

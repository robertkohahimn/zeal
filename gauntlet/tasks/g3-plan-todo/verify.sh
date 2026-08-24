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
#
# Two accepted shapes, because a todo write is legitimately recorded either
# as the tool call itself or as the dedicated `todo/write` event
# (normalize.ts lists 'todo/write' among the session event types alongside
# 'tool/call'); requiring only the first would fail a genuine run.
node "$GAUNTLET_LIB/find-session-event.mjs" \
  "$DSH_HOME/sessions" 'tool/call:name=todo_write' 'todo/write'

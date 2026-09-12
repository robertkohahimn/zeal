#!/usr/bin/env bash
# G5 verify: the task passes iff constant.txt (written by the model, in the
# scratch workdir gauntlet/run.sh copied repo/ into and setup.sh wired the
# zeal-lookup MCP server into) holds exactly the value the lookup_constant
# tool returns (ZEAL_MAGIC: 271828). $WORKDIR is set by gauntlet/run.sh.
#
# EXACT match, not `grep -q 271828`: a substring test also accepts content
# that merely embeds the digits — `x271828`, `1271828`, or a stray log line —
# so it could pass on a file the model never correctly populated. Surrounding
# whitespace is stripped (a trailing newline is normal and not a failure),
# but nothing else is tolerated. task.txt states this contract so the
# requirement is unambiguous from the model's side too.
set -euo pipefail

CONSTANT_FILE="$WORKDIR/constant.txt"

if [[ ! -f "$CONSTANT_FILE" ]]; then
  echo "verify.sh: $CONSTANT_FILE does not exist" >&2
  exit 1
fi

actual="$(tr -d '[:space:]' < "$CONSTANT_FILE")"
if [[ "$actual" != "271828" ]]; then
  echo "verify.sh: constant.txt must contain exactly 271828, got: '$actual'" >&2
  exit 1
fi

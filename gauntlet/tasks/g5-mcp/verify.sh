#!/usr/bin/env bash
# G5 verify: the task passes iff constant.txt (written by the model, in the
# scratch workdir gauntlet/run.sh copied repo/ into and setup.sh wired the
# zeal-lookup MCP server into) contains the value the lookup_constant tool
# returns (ZEAL_MAGIC: 271828). $WORKDIR is set by gauntlet/run.sh.
set -euo pipefail
grep -q 271828 "$WORKDIR/constant.txt"

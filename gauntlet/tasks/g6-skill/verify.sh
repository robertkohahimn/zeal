#!/usr/bin/env bash
# G6 verify: (1) the repo's own vitest suite passes (titleCase implemented
# correctly) in the scratch workdir gauntlet/run.sh copied repo/ into, AND
# (2) the new function actually carries the @zeal-checked JSDoc tag the
# repo's skill (repo/.dsh/skills/zeal-checked/SKILL.md — discovery path per
# $DSH_SRC/packages/skill/skill-filesystem/README.md's project-dsh root,
# rank 100) mandates. repo/AGENTS.md restates the same instruction as a
# fallback in case skill discovery isn't wired into this composition.
#
# $WORKDIR is set by gauntlet/run.sh.
set -euo pipefail
cd "$WORKDIR" && npx vitest run

if ! grep -rq '@zeal-checked' "$WORKDIR/src"; then
  echo "verify.sh: no @zeal-checked tag found under \$WORKDIR/src" >&2
  exit 1
fi

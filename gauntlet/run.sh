#!/usr/bin/env bash
#
# gauntlet/run.sh — build+pack the zeal bundle, install it (plus the
# gauntlet overlay, gauntlet/overlay.cordis.yml) into a fresh scratch `zeal`
# profile, copy the task's repo/ into a scratch workdir, run the task
# unattended through zeal-gauntlet-runner (packages/dsh-zeal/src/
# gauntlet-runner.ts), then run the task's own verify.sh. This script's own
# exit code is verify.sh's exit code (pass/fail): the model's own
# turn-completion status (the dsh process's exit code) is printed as a
# diagnostic but is NOT what decides pass/fail here — a task the model
# thinks it finished but got factually wrong must still fail the gauntlet.
#
# Usage:
#   gauntlet/run.sh <task-dir>
#   e.g. ZAI_API_KEY=<key> gauntlet/run.sh gauntlet/tasks/g1-fix-test
#
# Requires ZAI_API_KEY (or ZHIPU_API_KEY, for the zai-coding-cn route) in the
# environment — the composed zeal profile's llm-pi-ai config
# (packages/dsh-zeal/cordis.patch.yml) reads credentials from there. This
# script does not read or default that variable itself; it is passed through
# from the caller's environment to the `dsh` child process untouched.
#
# ZEAL_SKIP_BUILD=1 skips `pnpm run build` for the dsh-zeal package before
# packing (mirrors packages/dsh-zeal/tests/composition/helpers.ts's own
# ZEAL_SKIP_BUILD escape hatch) — set it when the caller already built the
# bundle and wants to avoid a redundant rebuild.
#
# Per-task customization: a task directory may optionally carry
# overlay.extra.cordis.yml and/or an executable setup.sh to extend the
# shared overlay beyond what gauntlet/overlay.cordis.yml provides (e.g. G5's
# extra MCP-client plugin, G7's extra llm-pi-ai retarget) — see step 4b
# below for the full mechanism and ordering.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-dir>" >&2
  exit 2
fi

# `dlx` pin — matches packages/dsh-zeal/tests/composition/helpers.ts's
# DSH_VERSION and Task 15's launcher. NEVER exec this workspace's own
# installed @deepseek-ai/dsh copy directly: its real bin.js fails with
# ERR_MODULE_NOT_FOUND for @deepseek-ai/cordis-plugin-group, a transitive
# dependency this workspace's .npmrc/pnpm overrides deliberately peer-block
# (see helpers.ts's own module doc for the full explanation). `pnpm dlx`
# resolves dsh's own complete, self-consistent dependency closure in an
# isolated location, independent of this workspace's install.
DSH_VERSION="0.1.0-rc.6"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/packages/dsh-zeal"
OVERLAY_FILE="$REPO_ROOT/gauntlet/overlay.cordis.yml"

TASK_DIR="$(cd "$1" && pwd)"
TASK_FILE="$TASK_DIR/task.txt"
VERIFY_FILE="$TASK_DIR/verify.sh"
TASK_REPO_DIR="$TASK_DIR/repo"

for required in "$TASK_FILE" "$VERIFY_FILE" "$TASK_REPO_DIR"; do
  if [[ ! -e "$required" ]]; then
    echo "gauntlet/run.sh: missing required task file/dir: $required" >&2
    exit 2
  fi
done

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/zeal-gauntlet-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

DSH_HOME_DIR="$SCRATCH/home"
WORKDIR="$SCRATCH/workdir"
mkdir -p "$DSH_HOME_DIR" "$WORKDIR"

echo "gauntlet/run.sh: task=$TASK_DIR"
echo "gauntlet/run.sh: scratch DSH_HOME=$DSH_HOME_DIR"
echo "gauntlet/run.sh: scratch workdir=$WORKDIR"

# --- 1. Build + pack the bundle --------------------------------------------
# `pnpm pack --ignore-scripts` only ships what's on disk under package.json's
# "files" globs, so lib/ has to be fresh first (same constraint helpers.ts's
# buildBundle() documents). `--ignore-scripts` suppresses the package's own
# `prepack` build hook, which exists for PUBLISHING (so a released tarball is
# never empty) — here the build is this script's own step, gated on
# ZEAL_SKIP_BUILD so a caller that already built is not made to build twice.
if [[ -z "${ZEAL_SKIP_BUILD:-}" ]]; then
  echo "gauntlet/run.sh: building @zealagent/dsh-zeal..."
  (cd "$BUNDLE_DIR" && pnpm run build)
else
  echo "gauntlet/run.sh: ZEAL_SKIP_BUILD set, skipping build"
fi

PACK_JSON="$(cd "$BUNDLE_DIR" && pnpm pack --ignore-scripts --json --pack-destination "$SCRATCH")"
TARBALL_PATH="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).filename)" "$PACK_JSON")"
echo "gauntlet/run.sh: packed tarball=$TARBALL_PATH"

# --- 2. Install the bundle + code-runtime into a fresh `zeal` profile ------
echo "gauntlet/run.sh: installing zeal profile..."
DSH_HOME="$DSH_HOME_DIR" pnpm dlx "@deepseek-ai/dsh@$DSH_VERSION" plugin --profile zeal add \
  "$TARBALL_PATH" @deepseek-ai/dsh-code-runtime-worker-thread

# --- 3. Append the gauntlet overlay onto the profile's own patch layer ----
# A freshly-initialized profile's own cordis.patch.yml is always the literal
# empty-array placeholder ("[]" — see a fresh profile's own cordis.yml
# comment: "composed as patches: each bundle..., then cordis.patch.yml, then
# any --patch overlays"). This profile was just created fresh in step 2
# above, so overwriting its cordis.patch.yml with the overlay's rows IS
# appending them onto that empty array.
cp "$OVERLAY_FILE" "$DSH_HOME_DIR/profiles/zeal/cordis.patch.yml"

# --- 4. Copy the task's repo/ into the scratch workdir ---------------------
cp -R "$TASK_REPO_DIR"/. "$WORKDIR"/

# --- 4b. Optional per-task customization hooks ------------------------------
# Some gauntlet tasks need more than the shared overlay: G5 (MCP) must add a
# whole extra plugin to the profile AND compute a path that only exists once
# WORKDIR is populated (step 4, above); G7 (compaction) needs to restate a
# whole extra cordis row (a full llm-pi-ai retarget) that has no runtime-
# computed values and can just be appended verbatim. Two independent,
# optional hooks cover both shapes — a task uses either, both, or neither:
#
#   gauntlet/tasks/<name>/overlay.extra.cordis.yml
#     Optional. If present, its bytes are appended verbatim onto the
#     profile's own cordis.patch.yml (step 3's copy of gauntlet/
#     overlay.cordis.yml), AFTER the shared overlay's rows — same
#     "restate the whole row" patch semantics the shared overlay's own
#     comments document (packages/dsh-zeal/tests/patch.test.ts's `Row` shape:
#     a flat list of `{ id?, name?, disabled?, config?, insert?: Row[] }`
#     rows; multiple independent `insert:` rows in one file are valid — see
#     that test's `rows.flatMap(r => r.insert ?? [])`). Static content only:
#     nothing in this file can reference $WORKDIR/$DSH_HOME, since it is
#     copied byte-for-byte before either is known to the task author.
#
#   gauntlet/tasks/<name>/setup.sh
#     Optional, must be executable. Run after step 4 (so $WORKDIR already
#     holds the task's repo/ fixture and any path inside it can be resolved
#     to an absolute path) and before the task runs. Receives DSH_HOME,
#     WORKDIR, TASK_DIR, REPO_ROOT, and DSH_VERSION exported in its
#     environment — the same values this script computed above, so a hook
#     can install additional plugins into the profile (mirroring step 2's
#     own `dsh plugin --profile zeal add` invocation via `pnpm dlx`) and/or
#     append a cordis row it had to generate at run time (e.g. one embedding
#     an absolute $WORKDIR path) directly onto
#     "$DSH_HOME/profiles/zeal/cordis.patch.yml". G5 uses this for exactly
#     that: `dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client` (spec
#     §4.5's doc-flow rehearsal), then appends an `insert:` row wiring that
#     plugin to G5's own repo/mcp-server.mjs by absolute path.
#
# Order: overlay.extra.cordis.yml (if any) is appended first, then setup.sh
# (if any) runs — so a setup.sh hook's own appends land after the static
# extra overlay's rows and can override rows the extra overlay set, if a
# task ever needs both. No shipped task currently uses both hooks at once.
OVERLAY_EXTRA="$TASK_DIR/overlay.extra.cordis.yml"
if [[ -f "$OVERLAY_EXTRA" ]]; then
  echo "gauntlet/run.sh: appending per-task overlay extension ($OVERLAY_EXTRA)..."
  cat "$OVERLAY_EXTRA" >> "$DSH_HOME_DIR/profiles/zeal/cordis.patch.yml"
fi

SETUP_HOOK="$TASK_DIR/setup.sh"
if [[ -x "$SETUP_HOOK" ]]; then
  echo "gauntlet/run.sh: running per-task setup hook ($SETUP_HOOK)..."
  DSH_HOME="$DSH_HOME_DIR" WORKDIR="$WORKDIR" TASK_DIR="$TASK_DIR" REPO_ROOT="$REPO_ROOT" DSH_VERSION="$DSH_VERSION" "$SETUP_HOOK"
fi

# --- 5. Run the task, unattended, through zeal-gauntlet-runner -------------
ZEAL_TASK="$(cat "$TASK_FILE")"
echo "gauntlet/run.sh: running task..."
set +e
(cd "$WORKDIR" && DSH_HOME="$DSH_HOME_DIR" ZEAL_TASK="$ZEAL_TASK" pnpm dlx "@deepseek-ai/dsh@$DSH_VERSION" --profile zeal)
dsh_exit=$?
set -e
echo "gauntlet/run.sh: dsh run exited $dsh_exit (diagnostic only — verify.sh decides pass/fail)"

# --- 6. Verify ---------------------------------------------------------------
# DSH_HOME is exported alongside WORKDIR so a task's verify.sh can grep the
# scratch session store (e.g. G3/G4/G7's session-event checks against
# "$DSH_HOME/sessions" — stored uncompressed per the shared overlay's
# session-persistence-jsonl override, see gauntlet/overlay.cordis.yml).
set +e
WORKDIR="$WORKDIR" DSH_HOME="$DSH_HOME_DIR" "$VERIFY_FILE"
verify_exit=$?
set -e

if [[ $verify_exit -eq 0 ]]; then
  echo "gauntlet/run.sh: PASS ($TASK_DIR)"
else
  echo "gauntlet/run.sh: FAIL ($TASK_DIR) — verify.sh exited $verify_exit"
fi
exit "$verify_exit"

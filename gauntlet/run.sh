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
# `pnpm pack` only ships what's on disk under package.json's "files" globs;
# it does not invoke the build script itself, so lib/ has to be fresh first
# (same constraint helpers.ts's buildBundle() documents).
if [[ -z "${ZEAL_SKIP_BUILD:-}" ]]; then
  echo "gauntlet/run.sh: building @zealagent/dsh-zeal..."
  (cd "$BUNDLE_DIR" && pnpm run build)
else
  echo "gauntlet/run.sh: ZEAL_SKIP_BUILD set, skipping build"
fi

PACK_JSON="$(cd "$BUNDLE_DIR" && pnpm pack --json --pack-destination "$SCRATCH")"
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

# --- 5. Run the task, unattended, through zeal-gauntlet-runner -------------
ZEAL_TASK="$(cat "$TASK_FILE")"
echo "gauntlet/run.sh: running task..."
set +e
(cd "$WORKDIR" && DSH_HOME="$DSH_HOME_DIR" ZEAL_TASK="$ZEAL_TASK" pnpm dlx "@deepseek-ai/dsh@$DSH_VERSION" --profile zeal)
dsh_exit=$?
set -e
echo "gauntlet/run.sh: dsh run exited $dsh_exit (diagnostic only — verify.sh decides pass/fail)"

# --- 6. Verify ---------------------------------------------------------------
set +e
WORKDIR="$WORKDIR" "$VERIFY_FILE"
verify_exit=$?
set -e

if [[ $verify_exit -eq 0 ]]; then
  echo "gauntlet/run.sh: PASS ($TASK_DIR)"
else
  echo "gauntlet/run.sh: FAIL ($TASK_DIR) — verify.sh exited $verify_exit"
fi
exit "$verify_exit"

# G8 — interrupt (manual procedure)

Unlike G2–G7, this gauntlet task has no `repo/`/`verify.sh` — it exercises
the *interactive* TUI (Esc-to-interrupt, then steering the next turn),
which the unattended `zeal-gauntlet-runner` driver deliberately never
mounts (`gauntlet/overlay.cordis.yml` disables `zeal-tui`/`zeal-startup`
for exactly that reason). It needs a real terminal, a human at the
keyboard, and `ZAI_API_KEY` — none of which this environment has — so it
is recorded as a scripted manual procedure instead of an automated task,
to be run for real once those are available.

## What this proves

Pressing Esc mid-turn aborts the active turn but preserves queued/steering
work (`keepInbox: true`), the status bar returns to idle promptly, and the
next message the user types is free to redirect the agent onto different
work — i.e. an interrupt is a steering tool, not just an emergency stop.

Source of truth for expected behavior (cite, so a human running this can
tell a real bug from expected behavior):

- `packages/dsh-zeal/src/tui/ui/App.tsx`'s global `useInput` handler: Esc
  (`key.escape`) calls `driver.interrupt()`, guarded so it never fires
  against a driver that may be mid-dispose during a `/resume` await window,
  and is swallowed instead by closing the `/resume` picker if one is open.
- `packages/dsh-zeal/src/tui/driver.ts`'s `interrupt()`: `this.liveAgent
  .cancel({ kind: 'user' }, { keepInbox: true })` — "Abort the active turn
  while preserving queued/steering work."
- `@deepseek-ai/dsh-agent`'s `Agent.cancel`/`CancelOptions` doc: "Clear
  queued and steering work — unless `keepInbox` — and abort the active turn
  or between-turn task, and `AgentStatus = 'idle' | 'running'`, emitted on
  every transition as `agent/status`: `running` begins when waking input
  starts cancellable pre-step processing and lasts while the driver drains,
  closes, or checkpoints turns."
- `packages/dsh-zeal/src/tui/ui/StatusBar.tsx`: the status segment renders
  literally `⏵ running (esc interrupts)` while running, `idle` otherwise
  (`RUNNING_HINT`/`IDLE_HINT` constants).

## Procedure

1. **Set up a scratch repo and a scratch `zeal` profile with the real,
   interactive TUI** (deliberately NOT the gauntlet overlay — that overlay
   disables `zeal-tui`, which this task requires to be mounted):

   ```bash
   # Run these from anywhere inside a checkout of this repository.
   # NOT `dirname "$0"`: this is a document meant to be pasted into an
   # interactive shell, where `$0` is the shell itself ("-zsh"), not this
   # file — and even sourced as a script, this file's own
   # gauntlet/tasks/g8-interrupt/../.. is the `gauntlet` directory, one
   # level short of the repo root, so Step 1's $REPO_ROOT/packages/dsh-zeal
   # would not exist.
   REPO_ROOT="$(git rev-parse --show-toplevel)"
   SCRATCH="$(mktemp -d)"
   DSH_HOME="$SCRATCH/home"
   WORKDIR="$SCRATCH/workdir"
   mkdir -p "$DSH_HOME" "$WORKDIR"
   git -C "$WORKDIR" init -q   # "a scratch repo" per the task brief

   (cd "$REPO_ROOT/packages/dsh-zeal" && pnpm run build)
   PACK_JSON="$(cd "$REPO_ROOT/packages/dsh-zeal" && pnpm pack --ignore-scripts --json --pack-destination "$SCRATCH")"
   TARBALL="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).filename)" "$PACK_JSON")"

   DSH_HOME="$DSH_HOME" pnpm dlx "@deepseek-ai/dsh@0.1.0-rc.6" plugin --profile zeal add \
     "$TARBALL" @deepseek-ai/dsh-code-runtime-worker-thread
   ```

2. **Start zeal interactively** in the scratch repo, with a real key
   (`read -rs` keeps it out of shell history — never paste it inline into a
   command):

   ```bash
   read -rs ZAI_API_KEY && export ZAI_API_KEY
   cd "$WORKDIR" && DSH_HOME="$DSH_HOME" \
     pnpm dlx "@deepseek-ai/dsh@0.1.0-rc.6" --profile zeal
   ```

3. **Ask for a long task** — something that takes many tool calls/turns so
   there is a comfortable window to interrupt mid-turn, e.g.:

   > Write a very thorough, well-organized 1500+ word design document to
   > DESIGN.md about how you would build a distributed job queue from
   > scratch, covering architecture, failure modes, and a rollout plan.
   > Think through it carefully before writing.

   Confirm the status bar shows `⏵ running (esc interrupts)` once the
   model starts working.

4. **Press Esc** while the status bar still reads `⏵ running (esc
   interrupts)` (mid-turn, ideally mid-tool-call or mid-generation, not
   right after submitting).

5. **Observe and record:**
   - [ ] The status bar returns to `idle` promptly (sub-second to a few
     seconds — bounded by how quickly the in-flight request/tool call
     aborts, not by the model finishing on its own).
   - [ ] The transcript does NOT show the model's turn completing normally
     (no clean "done" message for the long task) — it was genuinely cut
     off, not just fast.
   - [ ] The input editor is available for typing again once idle.

6. **Type a redirect message** that steers the agent onto different work,
   e.g.:

   > Actually, stop working on that design doc. Instead, just create a
   > file called redirect-worked.txt containing the single line
   > "redirected".

   Press Enter.

7. **Observe and record:**
   - [ ] The status bar returns to `⏵ running (esc interrupts)` for the new
     turn.
   - [ ] The agent acts on the REDIRECT, not the original long task (it
     should NOT resume writing DESIGN.md) — creates `redirect-worked.txt`
     with the requested content, ignoring the interrupted work.
   - [ ] `cat "$WORKDIR/redirect-worked.txt"` shows `redirected`.
   - [ ] The status bar returns to `idle` again once that turn completes.

8. **Clean up:**

   ```bash
   rm -rf "$SCRATCH"
   ```

## Recording the result

Record the outcome as a row in `GAUNTLET.md` alongside G1–G7, following the
same PENDING convention (this environment has neither `ZAI_API_KEY` nor an
interactive terminal), with the exact commands above so a future run with
both is a copy-paste away. Once actually run, replace PENDING with the
observed pass/fail per checklist item above (all boxes checked = pass;
document exactly which one failed and how, otherwise).

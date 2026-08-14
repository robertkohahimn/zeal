# Zeal Gauntlet

Recorded results of running Zeal's offline task gauntlet
(`gauntlet/run.sh <task-dir>`) — an unattended, machine-driven harness that
packs the `@zealagent/dsh-zeal` bundle, installs it into a fresh scratch
`zeal` profile with the `gauntlet/overlay.cordis.yml` overlay applied (TUI
disabled, `zeal-gauntlet-runner` driving the task instead), copies the
task's `repo/` fixture into a scratch workdir, runs the task through a real
model, and then runs the task's own `verify.sh` to decide pass/fail.

Each row below is one recorded run. `run.sh`'s own exit code (and thus the
row's Outcome) is `verify.sh`'s exit code, not the model's self-reported
turn-completion status.

| Task | Date | Model | Bundle version | dsh version | Outcome | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| G1 (`gauntlet/tasks/g1-fix-test`) | — | zai / glm-5.2 | 0.1.0 | 0.1.0-rc.6 | **PENDING (requires ZAI_API_KEY)** | Not yet run: no `ZAI_API_KEY` is available in this environment. Everything up to the model call (the `zeal-gauntlet-runner` plugin + its unit tests, the `gauntlet/overlay.cordis.yml` overlay, `gauntlet/run.sh`, the G1 fixture repo + `verify.sh`, and an overlay-composition `--dump-config` check reusing Task 16's helpers) is built and verified. To record this row for real, run:<br>`ZAI_API_KEY=<key> gauntlet/run.sh gauntlet/tasks/g1-fix-test` |
| smoke (`packages/dsh-zeal/tests/composition/live-smoke.test.ts`) | — | zai / glm-5.2 | 0.1.0 | 0.1.0-rc.6 | **PENDING (requires ZAI_API_KEY)** | Not yet run: no `ZAI_API_KEY` is available in this environment. The live-call test is double-gated (`ZAI_API_KEY` AND `ZEAL_COMPOSITION`) and confirmed to skip cleanly without a key — verified for real in this environment, along with a separate fake-credential probe (`ZEAL_COMPOSITION` only, no real key) that installs the same composed profile+overlay and confirms the run fails at the provider's own auth check (`dsh: AUTH: 401: {"code":"401","message":"token expired or incorrect"}`), proving the full chain up to the API boundary. To record this row for real, run:<br>`ZAI_API_KEY=<key> ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/live-smoke.test.ts` |

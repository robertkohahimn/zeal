# Zeal — a GLM-powered coding agent on DeepSeek Harness

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan
**Repo:** this repository (pnpm workspace, currently empty)

## 1. Summary

Zeal is an interactive terminal coding agent powered by Zhipu's GLM models, built
as out-of-tree plugin packages for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`, TypeScript/Cordis, "everything is a plugin", developer preview). Users run:

```sh
npx @zealagent/zeal        # bootstraps the dsh profile on first run, then launches
# equivalent after bootstrap:
dsh --profile zeal
```

Zeal composes dsh's existing agent spine (agent loop, fs/bash/edit/search tools,
subagents, workflows, skills, plan mode, todo, compaction, sandboxing, session
persistence) with:

- a **GLM provider configuration** via dsh's in-box `llm-pi-ai` adapter, whose
  pi-ai `zai` / `zai-coding-cn` catalogs ship GLM models against the Z.ai and
  bigmodel.cn coding endpoints (thinking format and tool-streaming quirks handled);
- a **rich Ink TUI** — the main build item — acting as renderer, interaction
  answerer, and turn driver;
- an **acceptance gauntlet** of real coding tasks as the quality bar.

We write no agent-loop, tool, or wire-protocol code. We write the TUI, a patch
layer, a launcher, and tests.

### Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Form factor | Interactive terminal agent (rich TUI) |
| Backend | Z.ai API, configurable base URL; self-hosted OpenAI-compatible supported via declared route |
| Repo strategy | Standalone plugin packages consuming `@deepseek-ai/dsh-*` from npm |
| Capabilities | Core loop + subagents + plan/todo + MCP client + skills & workflows |
| Success bar | Unit/component/replay tests + acceptance gauntlet of real coding tasks |
| Name / scope | Zeal, npm scope `@zealagent` |

## 2. Architecture

### 2.1 Layering

```
dsh CLI launcher (@deepseek-ai/dsh, npm, exact-pinned)
└── profile "zeal"  ($DSH_HOME/profiles/zeal)
    ├── layer 1: @deepseek-ai/dsh-base patch   (agent spine: loop, tools, subagents,
    │                                           workflows, skills, plan-mode, todo,
    │                                           compaction, sandbox, approval seams,
    │                                           session persistence, dormant llm-pi-ai)
    ├── layer 2: @zealagent/dsh-zeal patch     (GLM routes, model default, persona,
    │                                           row disables, TUI mount)
    └── layer 3: user's cordis.patch.yml       (their overrides, incl. MCP servers)
```

A patch **replaces** a targeted row's whole `config` (no merge), so every row we
touch is stated completely in our patch.

### 2.2 Packages (2)

**`@zealagent/dsh-zeal`** — the bundle. One package, following the upstream
`dsh-headless` idiom exactly: manifest declares
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and the runtime glue
ships as subpath exports of the same package so patch rows resolve against a
guaranteed-present direct profile dependency:

- `./startup` — arg parsing plugin over the `cmdlineArgs` seam
- `./tui` — the Ink TUI plugin (ink/react are this package's dependencies)
- `cordis.patch.yml` — the patch layer (§4)

Rationale (review C2): rows naming the bundle's own subpaths are resolvable by
construction; rows naming *other* out-of-tree packages depend on loader
resolution anchoring under pnpm's isolated layout, which is unverified. We do
not gamble on it.

**`@zealagent/zeal`** — the launcher. A small bin that: (1) checks the profile
exists; on first run, executes `dsh plugin --profile zeal add @zealagent/dsh-zeal
@deepseek-ai/dsh-code-runtime-worker-thread` (fresh custom profiles are
initialized from `DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']`, verified
in `app-boot/src/profile.ts`); (2) execs `dsh --profile zeal <args…>`. It pins
the `dsh` launcher version.

**Direct-dependency rule (review C3):** any patch row naming a package outside
the base/installation closure must be installed as a *direct* profile
dependency. The launcher owns this for `code-runtime`; the MCP documentation
owns it for `@deepseek-ai/dsh-mcp-client` (§4.5). `dsh plugin` warns on
non-bundle dependencies by design ("a plain library is fine").

The bundle also declares `code-runtime` in its own `dependencies`
(belt-and-braces under V5), and the README documents the launcher-less manual
install as the two-package form:
`dsh plugin --profile zeal add @zealagent/dsh-zeal @deepseek-ai/dsh-code-runtime-worker-thread`.

### 2.3 Version discipline (review A2)

Every `@deepseek-ai/*` dependency is an RC on a codebase that promises breaking
changes. Therefore: exact version pins (no ranges), committed lockfile, launcher
pins the dsh CLI version. Upgrades are deliberate events: bump pins on a branch,
run the composition invariant tests and full-tree snapshot (§6.3), review the
snapshot diff as the upgrade artifact, re-run the gauntlet before release.

Verified at design time: `@deepseek-ai/dsh` 0.1.0-rc.6; `dsh-base`,
`dsh-llm-pi-ai`, `dsh-mcp-client` at 0.0.1-rc.1. `dsh-llm-pi-ai` pins
`@earendil-works/pi-ai@^0.82.1`, which for 0.x resolves to **0.82.1** (caret
admits only patch bumps below 1.0); 0.82.1's `zai` catalog was extracted and
verified: glm-4.5-air, glm-4.7, glm-5-turbo, glm-5.1, glm-5.2 (1M context),
glm-5v-turbo, with `thinkingFormat: "zai"` and `zaiToolStream: true` on all
current models; `zai-coding-cn` is the identical catalog against
`https://open.bigmodel.cn/api/coding/paas/v4`.

### 2.4 Toolchain

TypeScript ESM, pnpm workspace, vitest (+ fast-check for property tests),
tsdown for builds — matching upstream so its patterns transfer. Repo layout:

```
packages/dsh-zeal/      # bundle: patch + startup + tui
packages/zeal/          # launcher bin
gauntlet/               # acceptance tasks, sample repos, overlay patch, driver
docs/superpowers/specs/ # this document
```

v1 targets macOS and Linux. Windows is out of scope (untested terminal raw-mode
and sandbox behavior).

## 3. The TUI (`@zealagent/dsh-zeal/tui`)

Not a passive renderer (review A1): the TUI is **renderer + interaction
answerers + turn driver**. Two Cordis plugins:

### 3.1 `zeal-startup`

Parses the app's arguments from `ctx.cmdlineArgs.get()` (the launcher hands
everything after its own flags verbatim; `dsh --profile tui --resume abc` is the
harness docs' own worked example): `--resume <sessionId>`, `--model <id>`,
`--help`. Publishes the parsed result as a provider service consumed by the TUI
plugin, mirroring `dsh-headless/startup`.

### 3.2 `zeal-tui` — turn driver

Injects `['agentDefaultModel', 'agents', 'sessions', 'approval', 'userQuestions',
'cmdlineArgs', 'appExit']` (final list at plan time). Uses the public registry
API demonstrated by the headless runner:

- create: `agents.create({ sessionId, meta: { cwd }, agentOptions, setup })` with
  `installModelSelection`; resume: via the registry's resume path
  (`ResumeAgentOptions` exists per the `dsh-agent` README; the exact
  load-and-resume flow and the `session-query-sqlite` picker API are open item
  **V6**), fed by `--resume` or the `/resume` picker;
- send: `agent.followup(createUserMessage(...))`; quiescence: `agent.whenIdle()`;
- input typed mid-turn queues as the next `followup`;
- interrupt (Esc): via the loop's abort path — exact API is open item **V2**;
- `/model` switches the mutable model selection at runtime across the configured
  routes' catalogs.

### 3.3 `zeal-tui` — interaction answerers (fail-closed seams)

Without these, base's `ask` approval policy rejects every gated tool call.

- **Approval answerer** (`dsh-user-approval`): a *global* waterfall listener on
  `approval/request` — the deployment's one terminal answerer, receiving all
  agents' requests (agent-scoped listeners see only their own; upstream directs
  "compose one terminal answerer per deployment"). Renders an inline panel
  (allow once / reject, informed by `permission-presets`), labeled by requesting
  agent. Quitting mid-request aborts it → `cancelled`; nothing is defaulted.
- **User-questions provider** (`dsh-user-questions`): a *singleton* —
  `ctx.userQuestions.registerProvider(provider)`, one active per context (review
  A5: a different registration discipline than approval; do not conflate).
  Renders option lists, multi-select, and custom answers. The request schema's
  `intent: { kind: 'plan-review', approve }` means **plan-mode approval flows
  through this seam**: the TUI renders a dedicated approve/revise panel for that
  intent, not a generic option list.

### 3.4 `zeal-tui` — renderer

Session events (seq-ordered, append-only `agent.session.events`; live push
subscription is open item **V1**) fold into a transcript store held outside
React; deltas batch per animation frame. Settled entries render into Ink's
`<Static>` region; only the live tail re-renders. **Stated limitation:** static
lines never re-wrap on terminal resize (standard for this class of tool).

Layout:

- streamed assistant markdown; GLM reasoning blocks dimmed and toggleable
  (**v1 narrowing — see §8**: reasoning renders always-dimmed, with no
  toggle);
- tool calls as one-line collapsible panels; bash shows a streaming output
  tail (**v1 narrowing — see §8**: fixed preview caps, no collapse/expand;
  previews appear at settle, not as a live streaming tail);
- subagent activity nested under the delegating tool call (how dsh surfaces it);
- status bar: model/route, session title, **token counts and context fill —
  never derived dollar cost** (the zai catalogs price all models at 0; a
  currency figure would be confidently wrong — review N1), sandbox mode,
  retry state during provider retries;
- input editor, **v1 boundary fixed** (review A6): multiline via explicit
  keybinding (not auto-detect), bracketed-paste support, input history,
  slash-command autocomplete menu. Explicitly out of v1: IME composition
  guarantees, kill-ring. This component is the highest-defect-density part of
  any TUI; the boundary is load-bearing.
- slash commands: bridge to dsh's `commands` seam where one exists (`/compact`,
  `/goal`); TUI-local: `/model`, `/resume`, `/help`, `/quit`.

### 3.5 Terminal ownership & exit paths (reviews A3, A12)

- `hmr` row disabled; harness logs route to a file under the profile directory —
  nothing but Ink writes to stdout.
- Ink runs the terminal in raw mode, so **Ctrl+C arrives as input bytes, not
  SIGINT**. Double-Ctrl+C is our quit keybinding; the quit path explicitly
  `sessions.flush()` then `ctx.appExit`. External SIGTERM goes through the
  launcher's shutdown controller.
- If the TUI throws: print a plain-text error, flush sessions, exit nonzero;
  `--resume` recovers. This claim depends on persistence write cadence — open
  item **V3** (§7).

### 3.6 Onboarding

If the first request fails with `MISSING_CREDENTIAL` (or the llm seam's
configurable-provider directory exposes credential status — checked at plan
time), the TUI renders a setup panel (which env var / credentials file, where to
get a key) instead of a raw error. The TUI never reads provider row config to
guess credential names — no coupling.

## 4. Composition — the bundle patch (`cordis.patch.yml`)

### 4.1 Provider (review C1: retarget, don't insert)

Base mounts `llm-pi-ai` **dormant** (zero routes until config or settings supply
profiles). The patch retargets that existing row:

```yaml
- id: llm-pi-ai
  config:
    providers:
      zai:                        # pi-ai catalog route: api.z.ai coding endpoint
        apiKeyEnv: ZAI_API_KEY
        reasoning: high
      zai-coding-cn:              # open.bigmodel.cn twin for mainland keys
        apiKeyEnv: ZHIPU_API_KEY
        reasoning: high

- id: agent-default-model         # base points at deepseek-official; retarget
  config:
    provider: zai
    model: glm-5.2                # newest, 1M context; /model switches at runtime

- id: llm-deepseek                # Zeal ships no DeepSeek route
  disabled: true
```

- Keys resolve per request through the credentials seam (env or owner-only
  hot-reloaded `$DSH_HOME/.credentials.yaml`); never in config or logs.
- A `llm-pi-ai:` section in `$DSH_HOME/settings.yaml` **overrides** this entry
  config without restart (the harness's designed precedence; also what the web
  Models page writes). Documented (review N3).
- Self-hosted GLM (vLLM/SGLang): a **documented, commented-out declared route**
  template in the README — `baseURL` + `openai-completions` protocol + models
  list with `thinkingFormat: zai` compat. Not an active row; no phantom
  providers by default.

### 4.2 Rows disabled

```yaml
- id: hmr                     # terminal ownership (§3.5)
  disabled: true
- id: session-telemetry-otel  # no telemetry by default in a third-party distribution
  disabled: true
- id: web-search-deepseek     # backend is DeepSeek's search API — a GLM user has
  disabled: true              # no credential for it; a dead tool in the toolbox is
- id: tool-web                # worse than an absent one. Re-enable = two-line user
  disabled: true              # patch with a DeepSeek key; documented.
```

### 4.3 Rows added

```yaml
- insert:
    - id: code-runtime        # upstream classifies Code Mode as core execution
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'
    - id: zeal-startup
      name: '@zealagent/dsh-zeal/startup'
    - id: zeal-tui
      name: '@zealagent/dsh-zeal/tui'
```

(`code-runtime` installed as a direct profile dep by the launcher — §2.2 rule.)

### 4.4 Persona

The `system-prompt` row gets Zeal's persona: identity, `{{model}}`/`{{cwd}}`
variables, verification-before-done norms, GLM-tuned tool-use guidance.
Deliberately short — base's `agent-instructions` row already loads per-repo
instruction files. Final wording is an output of the gauntlet, not a
design-time artifact.

### 4.5 MCP

The bundle ships **zero MCP servers**. The README documents the flow:

```sh
dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client   # not in base's closure (C3)
```

then per server, one row in the user's `cordis.patch.yml` (`transport: stdio`
with command/args/env — child env credential-scrubbed by the harness — or
`streamable-http` with url/headers). Tools appear as `mcp__<server>__<name>`,
approval-gated like every tool. A `/mcp add` convenience command is a possible
later milestone, not v1.

### 4.6 Untouched

Sandbox/approval/permission presets, compaction thresholds, session
persistence, subagent/workflow/skill wiring: base defaults stand; the TUI's
answerers give them their interactive surface.

## 5. Error handling & security

### 5.1 Errors

- Retryable provider failures: `llm-retry` (base) owns policy; the TUI renders
  attempt count and provider retry-after in the status lane.
- Terminal failures: `turn/end` error reason → mapped panel;
  `MISSING_CREDENTIAL` → onboarding panel (§3.6).
- Tool failures: ordinary tool-result panels; the loop feeds them to the model.
- Stream idleness: per-route `streamIdleTimeoutMs` defaults.
- Crash safety: persistence + flush-on-exit (§3.5), pending V3.
- Quit mid-approval: request aborts → `cancelled`; fail-closed, never defaulted.

### 5.2 Security

- No loosening of base defaults: sandboxed execution, `ask` policy, permission
  presets as shipped; sandbox mode always visible in the status bar.
- Keys confined to the credentials seam. MCP stdio children get the scrubbed
  environment (verified in `mcp-client/src/transport.ts`).
- Telemetry off. Exact pins + lockfile; launcher installs only named packages.
- The gauntlet's auto-approve overlay (§6.5) is test infrastructure, **never
  shipped in the bundle**, and runs in a disposable container.

## 6. Verification — five layers, cheapest first

1. **Unit (vitest + fast-check):** transcript store (fold of session events →
   view model; properties: append-only, order-stable, idempotent re-fold),
   input-editor semantics at the A6 boundary, answerer mapping, launcher
   bootstrap against a temp `DSH_HOME`.
2. **Component (ink-testing-library, pinned terminal width):** frame snapshots
   of each panel type from recorded event sequences — tool call, approval,
   plan-review, compaction notice, subagent nesting, onboarding.
3. **Composition (review A10, two tests):**
   (a) *invariant assertions* on exactly the rows Zeal touches, via
   `dsh --profile zeal --dump-config` — must-pass CI on every push;
   (b) *full-tree snapshot* updated deliberately during the §2.3 upgrade
   ritual — the diff is the upgrade review artifact. Splitting keeps the
   tripwire alive: a whole-tree diff failing on every harmless upstream change
   trains humans to ignore it.
4. **Live smoke (credential-gated):** one real GLM turn with a tool call
   against api.z.ai; skipped without `ZAI_API_KEY`.
5. **Acceptance gauntlet (§6.5).**

CI: layers 1–3 every push; 4–5 credential-gated/manual.

### 6.5 Gauntlet

Fixed tasks in sample repos, each verified by that repo's own test suite;
results recorded in `GAUNTLET.md` with model + pinned versions + date. Doubles
as the persona-tuning loop.

| # | Task | Verifies |
|---|---|---|
| G1 | Fix a failing test | core loop, edit/bash tools |
| G2 | Multi-file refactor | fs search, multi-edit coherence |
| G3 | Feature build using plan + todo | plan-mode, todo events |
| G4 | Delegation task | subagent spawn, nested rendering |
| G5 | Task requiring an MCP tool | mcp-client (local stdio test server via `@modelcontextprotocol/sdk`) |
| G6 | Task governed by a repo skill | skill loading/following |
| G7 | Long-session compaction survival | compaction mechanism |
| G8 | Interrupt-and-steer (manual TUI pass) | abort path, followup queueing |

Mechanics (review A11): scripted runs use **our own driver** on the public
registry API (`agents.create`/`followup`/`whenIdle`) — upstream's headless
driver is unexported test infrastructure. Runs compose the real zeal patch plus
a **gauntlet overlay** that: disables the `zeal-tui`/`zeal-startup` rows (a
scripted run must not grab the terminal, and the deployment gets exactly one
approval answerer — sibling listener order is not a priority mechanism); mounts
the driver, an auto-approve answerer, **and a machine `UserQuestionProvider`**
(the approval seam alone is not enough: plan review arrives through the
user-questions seam — §3.3 — so G3 would deadlock at `ctx.userQuestions.ask()`
with no provider registered; both fail-closed seams need machine substitutes);
and, for G7, sets a shrunk
`contextWindow` on the route's model entry so compaction triggers for pennies
instead of ~800k real tokens against glm-5.2's 1M window. G8 and approval flows
are manual TUI passes.

## 7. Open items (plan-time verification, not design blockers)

| # | Item | Why it's safe to defer |
|---|---|---|
| V1 | Live session-event push subscription mechanism | the web surface streams these events daily; mechanism exists, API unread |
| V2 | Exact turn-interrupt/abort API | `turn/end` has non-completed reasons; approval seam documents cancellation; web UI has stop |
| V3 | `session-persistence-jsonl` write cadence (streaming vs flush-only) | if flush-only, TUI adds periodic flush (e.g., per `turn/end`); crash-recovery claim in §3.5/§5.1 is conditional on this |
| V4 | `session-title-first-prompt-llm` model routing with `llm-deepseek` disabled (review N2) | if it pins DeepSeek, titles fail silently → reconfigure or disable the row |
| V5 | Loader resolution anchor for out-of-tree plugin names | design already avoids depending on it (C2/C3); verifying may relax the direct-dep rule |
| V6 | Exact session resume flow (`ResumeAgentOptions` load path) and `session-query-sqlite` picker API | type names verified in READMEs; both are exercised by the web surface |
| V7 | `llm-pi-ai:` settings-section layering semantics (whole-dict replace vs per-route merge) | `$DSH_HOME/settings.yaml` is home-level and shared across profiles — a section written by a prior `dsh web` run overrides Zeal's entry-config routes; wrong assumption → Zeal boots with zero GLM routes. Onboarding panel (§3.6) must mention this override path if V7 confirms replacement semantics |

### Resolutions (2026-08-14, verified against harness source by three research passes)

- **V1 — resolved.** Live push exists: `ctx.on('session/event', (session, event) => …)`, emitted
  synchronously inside `Session.append()` (`packages/core/session/src/index.ts:76`, dispatch
  `:641`). Per-delta (`assistant/chunk` carries raw `StreamChunk`s). Register on `agent.ctx`
  (or in `setup(agentCtx)`) for one agent's feed. Constructor seeds (resume/fork history) are
  never re-emitted — replay `agent.session.events` below `session.firstLiveSeq` manually.
- **V2 — resolved.** `agent.cancel(cause: AgentCancelCause, options?: { keepInbox?: boolean })`
  (`packages/core/agent/src/runtime-types.ts:85`); synchronous; aborts the in-flight provider
  request; produces `turn/end` reason `{ kind: 'aborted' }`. The web stop button calls exactly
  `agent.cancel({ kind: 'user' }, { keepInbox: true })`. Await `agent.whenIdle()` to observe.
- **V3 — resolved, favorably.** Persistence is streaming: every `session/event` enters a
  write-behind queue with a fixed 200 ms window, then a durable append with per-batch fsync;
  checkpoint policy additionally flushes before every model request and top-level tool call.
  Torn zstd frames are repaired on load. Crash loses ≤ the last ~200 ms. No periodic TUI flush
  needed; quit-path `sessions.flush()` stands.
- **V4 — resolved, favorably.** Title generation inherits the exact route from the session's
  logged `request/header` when `provider`/`model` are unset — and base's row sets neither.
  Titles ride the `zai` route; disabling `llm-deepseek` breaks nothing.
- **V5 — resolved.** Row `name:` resolution is single-anchored at the **profile directory**
  (Node ESM parent-walk); dsh-initialized profiles get `nodeLinker: hoisted`, so a bundle's
  regular (non-peer) dependencies land at the profile root and resolve. Hardened rule: every
  package our patch rows name is a **regular dependency of the bundle** (never a peer); the
  launcher's direct install of `code-runtime` stays as insurance against version-conflict
  nesting. Do not touch the dsh-written `pnpm-workspace.yaml`.
- **V6 — resolved.** `ctx.agents.resume({ resumeSessionId, agentOptions?, setup? })` →
  `AgentHandle` (`packages/core/agent/src/index.ts:424`; requires the persistence backend base
  mounts). Picker: `ctx.sessionQuery.listSessions()` (newest-first, live+cold) +
  `readTitleSnapshots(ids)`; `filterSessions` supports a `cwd` filter.
- **V7 — resolved, favorably.** Settings-section layering is a per-key **deep merge**: the
  `providers` dict merges per route, and settings can add or override routes but **cannot
  remove** composition routes (upstream test `llm-pi-ai/tests/dynamic-config.spec.ts:89-114`
  proves the exact both-routes-survive scenario). The "zero GLM routes" fear is retired; what
  remains is a README note that `settings.yaml` is home-level and shared across profiles, so a
  section written by `dsh web` can override individual fields of Zeal's routes.
- **Commands seam (post-spec verification).** `ctx.commands.execute(agent, line, signal)`
  runs registered slash commands (`/compact`, `/goal`, `/plan` from base's producers);
  `list(agent)` feeds autocomplete. The TUI dispatches any `/`-prefixed input through it and
  falls back to its local commands.

## 8. Out of scope for v1

Windows support; the dsh Web UI; benchmark scoring (BENCHMARK.md-style);
`/mcp add` command; IME/kill-ring editor features; a dedicated `llm-glm`
provider plugin (fallback only if pi-ai's compat knobs prove insufficient — the
patch isolates the provider rows so a swap is one layer).

Three §3.4 renderer promises narrowed during implementation (final-review fix
wave, Ruling R5 / I6c) — each is a genuine v1 boundary, not a bug, and each is
flagged inline at its §3.4 callout above:

- **Reasoning-block toggle.** §3.4 says GLM reasoning blocks are "dimmed and
  toggleable." v1 renders reasoning always-dimmed (`Transcript.tsx`); there is
  no keybinding or command to show/hide it. A toggle is a small, self-contained
  follow-up once there's a natural keybinding slot for it.
- **Collapsible tool panels.** §3.4 says tool calls render as "one-line
  collapsible panels." v1's `ToolPanel` has no collapse/expand interaction —
  previews are shown at a fixed cap (a handful of lines for a settled `ok`
  result, more for `error`) with no way to expand past it or collapse further.
- **Bash streaming output tail.** §3.4 says bash "shows a streaming output
  tail." v1 shows the tool's preview only once it settles (`tool/result`), not
  as a live-updating tail while the command is still running — a long-running
  bash call shows only the running-spinner `ToolPanel` until it finishes.

## 9. Decision log

| Decision | Alternatives rejected | Why |
|---|---|---|
| pi-ai bridge for provider | dedicated `llm-glm` plugin; fork of dsh | wire protocol + GLM quirks already handled and tested upstream; provider becomes config; patch isolation keeps the swap-out option |
| One bundle package with subpath plugin exports | separate TUI package | out-of-tree resolution guarantee; upstream `dsh-headless` idiom (C2) |
| Disable web search | keep DeepSeek-backed search | GLM users hold no DeepSeek credential; dead tool worse than absent (A4) |
| glm-5.2 default | glm-4.7 | newest, 1M context; `/model` switches freely |
| Telemetry off | upstream default | third-party distribution; user opt-in via their patch |

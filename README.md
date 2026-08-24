# Zeal

Zeal is an interactive terminal coding agent powered by Zhipu's GLM models,
built as out-of-tree plugin packages for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`, TypeScript/Cordis, "everything is a plugin"). It composes `dsh`'s
existing agent spine — agent loop, fs/bash/edit/search tools, subagents,
workflows, skills, plan mode, todo, compaction, sandboxing, session
persistence — with:

- a **GLM provider configuration**, via `dsh`'s in-box `llm-pi-ai` adapter,
  whose `zai` / `zai-coding-cn` catalogs ship GLM models against the Z.ai and
  bigmodel.cn coding endpoints;
- a **rich Ink terminal UI** acting as renderer, interaction answerer, and
  turn driver;
- an **acceptance gauntlet** of real coding tasks as the quality bar (see
  [`GAUNTLET.md`](./GAUNTLET.md)).

Zeal writes no agent-loop, tool, or wire-protocol code of its own — that's
all `dsh`. Zeal is the TUI, a composition patch, a launcher, and tests.

## Quickstart

**Requirements:** Node.js >= 22 (both packages' `engines` field); [pnpm](https://pnpm.io)
only if you're building from source instead of running via `npx` — see
[Development](#development) below.

```sh
npx @zealagent/zeal
```

On first run this bootstraps a `zeal` `dsh` profile under `$DSH_HOME`
(defaults to `~/.dsh`; override with the `DSH_HOME` environment variable) —
installing the `@zealagent/dsh-zeal` bundle plus
`@deepseek-ai/dsh-code-runtime-worker-thread` into it — then launches. Every
run after that is equivalent to:

```sh
dsh --profile zeal
```

(`packages/zeal/src/main.ts` decides whether bootstrap is needed by checking
whether `$DSH_HOME/profiles/zeal/package.json` already lists
`@zealagent/dsh-zeal` as a dependency, then execs `dsh --profile zeal
<your args>`.)

Useful flags, parsed by the bundle's `zeal-startup` plugin
(`packages/dsh-zeal/src/startup.ts`):

- `--resume <sessionId>` — resume a persisted session
- `--model <id>` — set the initial model id on the default route
- `--help` — dsh/commander help

In-session slash commands:

- `/model <id> [provider]` — switch the active model, and optionally the
  route it runs on (see [Self-hosted GLM](#self-hosted-glm-vllm--sglang) for
  when the second argument matters)
- `/resume` — pick a persisted session to resume
- `/help` — list available commands
- `/quit` — quiesce the active turn, flush the session, and exit

### API keys

Zeal ships two GLM routes and needs a key for whichever one you use:

| Route | Backend | Env var |
|---|---|---|
| `zai` | api.z.ai coding endpoint | `ZAI_API_KEY` |
| `zai-coding-cn` | open.bigmodel.cn coding endpoint | `ZHIPU_API_KEY` |

Set the appropriate variable in your environment, or add it to the
owner-only, hot-reloaded `$DSH_HOME/.credentials.yaml` file. Keys are never
read from `cordis.patch.yml` (a committed file — never put a key there) and
never written to logs. If the first request fails with a missing-credential
error, the TUI shows an onboarding panel naming the exact variable to set
instead of a raw error.

**`settings.yaml` and key material.** A `llm-pi-ai:` section in
`$DSH_HOME/settings.yaml` deep-merges per route over Zeal's own route config
(see [Settings precedence](#settings-precedence)), so a key set on a route
there *is* honored — this is the third path the onboarding panel mentions.
Prefer the environment variable or `.credentials.yaml` anyway:

- `settings.yaml` is **home-level and shared across every profile** on the
  machine, so a key there is not scoped to `zeal`.
- Unlike `.credentials.yaml`, it is a general settings file and is not
  treated as a secret store. If you do put a key in it, restrict it
  yourself: `chmod 600 "$DSH_HOME/settings.yaml"`.
- The route-level `apiKeyEnv` field is the better `settings.yaml` override:
  it names a *different environment variable* to read the key from, which
  keeps the key itself out of the file entirely.

## Manual install

If you'd rather not use the `zeal` launcher, install the bundle directly into
an existing `dsh` profile:

```sh
dsh plugin --profile zeal add @zealagent/dsh-zeal @deepseek-ai/dsh-code-runtime-worker-thread
```

then run `dsh --profile zeal` as above. Both packages are named explicitly
because `code-runtime` sits outside the base bundle's dependency closure and
must be installed as a direct profile dependency (see
[`packages/dsh-zeal/README.md`](./packages/dsh-zeal/README.md) for why).

## MCP servers

The bundle ships with **zero** MCP servers by default. To add one:

1. Install the MCP client plugin into your profile (it isn't part of the
   base bundle's dependency closure, so it needs an explicit add, same as
   `code-runtime` above):

   ```sh
   dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client
   ```

2. Add one row per server to your own `cordis.patch.yml`
   (`$DSH_HOME/profiles/zeal/cordis.patch.yml`). One plugin instance per
   server; `transport: stdio` for a spawned child process, or
   `transport: streamable-http` for a remote server:

   ```yaml
   - id: mcp-github
     name: '@deepseek-ai/dsh-mcp-client'
     config:
       serverName: github
       transport: stdio
       command: npx
       args: ['-y', '@modelcontextprotocol/server-github']
       env:
         GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

   - id: mcp-web
     name: '@deepseek-ai/dsh-mcp-client'
     config:
       serverName: web
       transport: streamable-http
       url: http://localhost:3000/mcp
       headers:
         Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
   ```

Tools from each server appear to the model as `mcp__<serverName>__<toolName>`
and are approval-gated exactly like every other tool. There is no `/mcp add`
convenience command in v1 — editing `cordis.patch.yml` is the whole flow.

## Self-hosted GLM (vLLM / SGLang)

Zeal's shipped routes (`zai`, `zai-coding-cn`) point at Z.ai's hosted
endpoints. To point at a self-hosted, OpenAI-compatible GLM deployment
instead, declare a hand-rolled route in your own `cordis.patch.yml` — this is
not an active row by default, so uncomment and adapt it:

```yaml
# - id: llm-pi-ai
#   config:
#     providers:
#       zai-self-hosted:
#         displayName: Self-hosted GLM
#         apiKeyEnv: ZAI_SELF_HOSTED_API_KEY
#         api: openai-completions
#         baseURL: https://your-vllm-or-sglang-host:8000/v1
#         compat:
#           thinkingFormat: zai
#         models:
#           - id: glm-5.2
#             name: GLM-5.2
#             contextWindow: 1000000
#             maxTokens: 32768
```

`baseURL` plus `api: openai-completions` tells the `llm-pi-ai` adapter this
is a hand-declared route (nothing pi-ai's installed catalog already ships
under that key), so the profile must supply the whole provider: endpoint,
protocol, and model list. `compat.thinkingFormat: zai` tells the adapter how
GLM's reasoning traces travel over the wire, since a self-hosted URL gives it
no endpoint to guess the dialect from.

**Declaring the route does not select it.** The block above only *adds*
`zai-self-hosted` to the provider map; the default selection still points at
the shipped `zai` route, and `--model <id>` changes only the model id on
whatever route is already selected — not the route itself. Pick one of:

- **Per session** — switch at the prompt, provider included:

  ```
  /model glm-5.2 zai-self-hosted
  ```

- **Persistently** — also override the default selection in your
  `cordis.patch.yml`, so every new session starts on the self-hosted route:

  ```yaml
  - id: agent-default-model
    config:
      provider: zai-self-hosted
      model: glm-5.2
  ```

  A patch row replaces that row's whole config, so restate both fields.

## Re-enabling web search

Zeal disables the `web-search-deepseek` and `tool-web` rows by default: the
shipped search backend is DeepSeek's own search API, and a GLM-only user has
no `DEEPSEEK_API_KEY` to call it with — a dead tool in the toolbox is worse
than an absent one. If you do hold a DeepSeek key, re-enable both rows with a
two-line patch:

```yaml
- { id: web-search-deepseek, disabled: false }
- { id: tool-web, disabled: false }
```

Add this to your own `cordis.patch.yml` and set `DEEPSEEK_API_KEY` in your
environment (or `$DSH_HOME/.credentials.yaml`) — that's the same credential
DeepSeek's own web UI's Models page manages.

## Settings precedence

`$DSH_HOME/settings.yaml` is **home-level**, shared across every profile on
the machine — not scoped to `zeal`. A `llm-pi-ai:` section written there (for
example by a prior `dsh web` session) deep-merges **per route** with the
routes Zeal's patch configures: settings can add a new route or override
individual fields of an existing one (its `apiKeyEnv`, `baseURL`, and so on),
but they can never remove a route Zeal's composition configures — the `zai`
and `zai-coding-cn` routes always survive. Keep this in mind if GLM behavior
changes unexpectedly after using another `dsh` profile or the web UI on the
same machine.

## Terminal UI limitations

- Settled transcript lines render into Ink's `<Static>` region for
  performance; only the live tail re-renders on each frame. **Static lines
  never re-wrap on terminal resize** — this is standard for this class of
  TUI, but be aware that resizing your terminal mid-session will not reflow
  already-printed output.
- The status bar shows a `ctx NN%` context-fill segment once the first reply
  with token usage lands — computed from that reply's own token count
  against the current model's context window (a small static table in
  `packages/dsh-zeal/src/tui/model-windows.ts`; an unrecognized model id
  falls back to 200k). It reflects only the LATEST reply, not a running sum
  across the session, and is omitted entirely before any usage has arrived.
  It never shows raw token counts or a derived dollar cost — the `zai`
  catalogs price every model at 0, so a currency figure would be confidently
  wrong rather than merely absent.
- Multiline input is via an explicit keybinding, not auto-detection.
  IME composition guarantees and a kill-ring are out of scope for v1.
- GLM reasoning renders always-dimmed, with no toggle to show/hide it; tool
  call panels show a fixed-size preview with no collapse/expand interaction;
  and a running bash call shows only a spinner until it settles — its output
  is not streamed live, only shown as a preview once the call finishes. See
  the design spec's §8 ("Out of scope for v1") for the full rationale on each.
- While the input line starts with `/`, a dim hint line under the editor
  lists up to 6 matching command names — display only, there is no
  tab-cycling or selection.

## Platform support

Zeal targets **macOS and Linux**. Windows is out of scope for v1 (raw-mode
terminal and sandbox behavior are untested there).

Running Zeal interactively **requires a real TTY** — Ink puts the terminal
into raw mode to own keyboard input, so the TUI cannot run attached to a
pipe or a non-interactive shell. (The offline gauntlet works around this by
disabling the TUI rows entirely and driving the agent through a headless
runner instead — see [Gauntlet](#gauntlet) below.)

## Upgrading

Every `@deepseek-ai/*` dependency here is a release candidate on a codebase
that promises breaking changes, so Zeal pins exact versions everywhere (no
semver ranges) with a committed lockfile, and the `@zealagent/zeal` launcher
pins its own `@deepseek-ai/dsh` version too. Upgrades are a deliberate,
reviewed event, not a routine `pnpm update`:

1. Bump the pins on a branch.
2. Run the composition invariant tests and the full-tree composition
   snapshot, both gated behind `ZEAL_COMPOSITION=1` (they bootstrap a real
   `dsh` profile through the real CLI, so they're skipped by default):

   ```sh
   ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/invariants.test.ts
   ```

3. Review the composed-tree snapshot diff — that diff *is* the upgrade
   review artifact. It tells you exactly what changed underneath Zeal's
   patch in the new upstream version.
4. Re-run the acceptance gauntlet (below) against the bumped pins.
5. Release.

## Gauntlet

`gauntlet/run.sh <task-dir>` is the offline acceptance harness: it builds
and packs the `@zealagent/dsh-zeal` bundle, installs it (plus the
`gauntlet/overlay.cordis.yml` overlay, which disables the interactive TUI
rows and mounts a scripted driver + auto-approve answerers instead) into a
fresh scratch `zeal` profile, copies the task's `repo/` fixture into a
scratch workdir, runs the task unattended, and then runs the task's own
`verify.sh` to decide pass/fail — the model's own turn-completion status is
printed as a diagnostic only, never what decides the outcome.

```sh
ZAI_API_KEY=<key> gauntlet/run.sh gauntlet/tasks/g1-fix-test
```

(`ZHIPU_API_KEY` works too, for the `zai-coding-cn` route; the script passes
through whatever credential is in your environment untouched.)

[`GAUNTLET.md`](./GAUNTLET.md) is the evidence record: one row per gauntlet
task (G1–G8) with date, model, bundle/`dsh` versions, outcome, and notes on
how each result was produced or mechanically verified. It's both the
project's quality bar and its persona-tuning log.

As of this writing, every row in `GAUNTLET.md` is recorded **PENDING** — no
live `ZAI_API_KEY` was available during development; see `GAUNTLET.md`'s own
per-row notes for how each task was verified mechanically in its absence.

## Packages

| Package | Role |
|---|---|
| [`packages/dsh-zeal`](./packages/dsh-zeal/README.md) | The bundle: composition patch, TUI, gauntlet runner |
| [`packages/zeal`](./packages/zeal/README.md) | The launcher: `npx @zealagent/zeal` bootstrap + exec |

## Development

```sh
pnpm install
pnpm run build       # pnpm -r run build
pnpm test            # vitest run
pnpm run typecheck   # pnpm -r exec tsc --noEmit
```

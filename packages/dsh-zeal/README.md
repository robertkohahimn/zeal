# @zealagent/dsh-zeal

The Zeal bundle: a `dsh` composition patch that turns
`@deepseek-ai/dsh-base` into a GLM-powered coding agent, plus the Ink TUI and
gauntlet runner that ride on top of it. This package is not run directly —
it's installed into a `dsh` profile (by the [`@zealagent/zeal`](../zeal/README.md)
launcher, or manually — see the [root README](../../README.md)) and composed
by `dsh` itself.

Requires Node.js >= 22 (this package's `package.json` `engines` field).

```sh
dsh plugin --profile zeal add @zealagent/dsh-zeal @deepseek-ai/dsh-code-runtime-worker-thread
dsh --profile zeal
```

## What the patch does

`cordis.patch.yml` is declared as this package's bundle patch
(`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` in `package.json`)
and is composed as **layer 2**, above `dsh-base` and below anything the
user's own profile `cordis.patch.yml` adds. A patch row **replaces** the
targeted row's whole `config` — nothing merges — so every row below states
its config completely.

| Row id | What it does |
|---|---|
| `llm-pi-ai` | Retargets base's dormant `llm-pi-ai` adapter live: adds the `zai` route (`apiKeyEnv: ZAI_API_KEY`) against api.z.ai's coding endpoint, and the `zai-coding-cn` route (`apiKeyEnv: ZHIPU_API_KEY`) against open.bigmodel.cn's twin, both with `reasoning: high`. |
| `agent-default-model` | Points the default model at `provider: zai`, `model: glm-5.2` (newest GLM model, 1M context). `/model` switches at runtime. |
| `llm-deepseek` | `disabled: true` — Zeal ships no DeepSeek route. |
| `hmr` | `disabled: true` — Ink owns the terminal; module-reload watching would fight it. |
| `session-telemetry-otel` | `disabled: true` — no telemetry by default in a third-party distribution. |
| `web-search-deepseek` | `disabled: true` — its backend is DeepSeek's search API; a GLM-only user holds no credential for it. Re-enabling is a two-line user patch — see the [root README](../../README.md#re-enabling-web-search). |
| `tool-web` | `disabled: true`, same reason as `web-search-deepseek`. |
| `system-prompt` | Sets Zeal's persona: identity, `{{model}}`/`{{cwd}}` template variables, verification-before-done norms, GLM-tuned tool-use guidance. Deliberately short — base's `agent-instructions` row already loads per-repo instruction files. |
| `code-runtime`, `zeal-startup`, `zeal-tui` (via `insert:`) | Adds three new rows: the upstream Code Mode execution plugin, and this bundle's own `./startup` and `./tui` subpath exports. |

Everything else — sandbox/approval/permission presets, compaction
thresholds, session persistence, subagent/workflow/skill wiring — is left at
base's defaults; the TUI's interaction answerers just give them their
interactive surface.

Self-hosted GLM deployments (vLLM/SGLang) are **not** an active row in this
patch — see the [root README's self-hosted section](../../README.md#self-hosted-glm-vllm--sglang)
for the commented declared-route template a user adds to their own patch.

## Exports

| Subpath | Points at | Purpose |
|---|---|---|
| `.` / `./startup` | `lib/startup.js` | The `zeal-startup` Cordis plugin — parses `--resume`/`--model`/`--help` off `ctx.cmdlineArgs` and publishes them as the `zealStartup` service. |
| `./tui` | `lib/tui/index.js` | The `zeal-tui` Cordis plugin — mounts the Ink terminal UI (renderer + interaction answerers + turn driver). |
| `./gauntlet-runner` | `lib/gauntlet-runner.js` | A one-shot, non-interactive Agent driver used only by `gauntlet/run.sh`'s scripted runs (via the gauntlet overlay) — never composed by the real `zeal` profile. |
| `./cordis.patch.yml` | `cordis.patch.yml` | The bundle patch itself (§ above). |
| `./package.json` | `package.json` | Standard subpath export. |

Every row `cordis.patch.yml` names via `insert:` (`code-runtime`,
`zeal-startup`, `zeal-tui`) resolves against a package this bundle declares
as a regular (never peer) dependency — either itself, via these subpath
exports, or `@deepseek-ai/dsh-code-runtime-worker-thread` directly — so row
resolution never depends on how a profile happens to hoist unrelated
packages.

## Config

### `zeal-tui`

```ts
interface Config { logFile?: string }
```

`logFile` defaults to `$DSH_HOME/profiles/zeal/logs/zeal.log`
(`defaultLogPath()` in `src/tui/index.ts`). While the TUI is mounted, Ink
owns the terminal exclusively — `process.stderr.write` and
`console.log`/`warn`/`error` are redirected to this file for the duration of
the session (`src/tui/stdio.ts`'s `redirectDiagnostics`), and restored on
quit before the terminal is handed back.

### `zeal-startup`

No config of its own; it parses the app's own arguments (everything after
the launcher's `--profile zeal`) into:

- `--resume <sessionId>` — a persisted session id to resume
- `--model <id>` — the initial model id on the default route

and publishes them as the `zealStartup` context service, consumed by
`zeal-tui` at boot.

### Credentials

Both GLM routes resolve their key per request through `dsh`'s credentials
seam — environment variable first, then the owner-only, hot-reloaded
`$DSH_HOME/.credentials.yaml` — never from this patch's config and never
logged. See the [root README's API keys section](../../README.md#api-keys).

## Testing

```sh
pnpm run build   # tsdown (--dts --unbundle, see package.json) + scripts/assert-dts-exports.mjs regression guard
pnpm vitest run  # unit + component layers (fast, no network)
ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/invariants.test.ts   # composes against the real dsh CLI (slow, network)
```

The composition suite (`tests/composition/`) is gated behind
`ZEAL_COMPOSITION=1` because it bootstraps a real `dsh` profile through the
real CLI via `pnpm dlx`. It proves two things the local patch-file tests
(`tests/patch.test.ts`) can't: that this patch actually applies over the
real `@deepseek-ai/dsh-base` bundle, and that the composed full tree matches
a committed snapshot — the deliberate-update artifact an upgrade review
reads (see the [root README's upgrading section](../../README.md#upgrading)).

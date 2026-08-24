# Zeal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Zeal — a GLM-powered interactive terminal coding agent — as two npm packages over DeepSeek Harness (`dsh`): a plugin bundle (`@zealagent/dsh-zeal`: patch layer + Ink TUI) and a launcher (`@zealagent/zeal`).

**Architecture:** dsh composes the whole agent spine (loop, tools, subagents, skills, compaction, sandbox, persistence) from its `dsh-base` bundle; our bundle is a patch layer over base that activates GLM routes on the in-box `llm-pi-ai` adapter and mounts our TUI plugins. The TUI is renderer + interaction answerers + turn driver over verified public APIs (`ctx.on('session/event')`, `agent.cancel`, `agents.create/resume`, `ctx.commands.execute`, approval waterfall, `userQuestions.registerProvider`).

**Tech Stack:** TypeScript ESM (NodeNext), pnpm workspace, Ink 7 + React 19, vitest + fast-check + ink-testing-library, tsdown. Harness packages from npm at exact-pinned RC versions.

**Spec:** `docs/superpowers/specs/2026-08-14-zeal-glm-coding-agent-design.md` — read it first; its §7 "Resolutions" block records the verified API facts this plan cites. A local clone of the harness for reference reading lives at `/private/tmp/claude-502/-Users-Maestro-emdash-projects-worktrees-dev-8xc/1b42fc3a-02a1-4045-a0ff-7958dcb9561d/scratchpad/deepseek-harness` (re-clone `https://github.com/deepseek-ai/deepseek-harness` shallow if absent; referred to below as `$DSH_SRC`).

## Global Constraints

- Every `@deepseek-ai/*` dependency is pinned EXACT (no `^`/`~`): `@deepseek-ai/dsh@0.1.0-rc.6`; all other `@deepseek-ai/dsh-*` at `0.0.1-rc.1` unless `npm view` shows a different current RC — verify each at install with `npm view <pkg> version` and pin what npm reports. Lockfile committed.
- Third-party deps use caret ranges + lockfile: `ink@^7.1.1`, `react@^19.2.0` (ink 7 peer floor), `@types/react@^19.2.0`, `marked@^18.0.9`, `commander@^13`, `fast-check@^4.9.0`, `ink-testing-library@^4.0.0`, `yaml@^2`.
- Node `>=22` (engines field in both packages).
- Packages: `@zealagent/dsh-zeal` (private until release), `@zealagent/zeal`. Plugin name strings: `zeal-startup`, `zeal-tui`, `zeal-gauntlet-runner`.
- Every package a patch row names MUST be a regular (non-peer) `dependency` of the bundle (spec V5). Never modify a profile's `pnpm-workspace.yaml`.
- TDD per task: write the failing test, watch it fail, implement, watch it pass, commit. Frame-snapshot tests pin terminal width 80.
- All raw harness payload shapes are touched ONLY in `normalize.ts` (session events) and `answerers.ts` (approval/questions seams). Every other file consumes our own types.
- Commit after every task, message style `feat(zeal): <what>` / `test(zeal): <what>` / `docs(zeal): <what>`.

## File Structure

```
package.json                     # workspace root: scripts only
pnpm-workspace.yaml              # packages/*
tsconfig.base.json               # NodeNext, strict, jsx react-jsx
vitest.config.ts
packages/dsh-zeal/
  package.json                   # dsh.bundle manifest + subpath exports
  tsconfig.json
  cordis.patch.yml               # the Zeal patch layer (spec §4)
  src/
    startup.ts                   # zeal-startup plugin (cmdline → service)
    gauntlet-runner.ts           # headless driver used ONLY by the gauntlet overlay
    tui/
      index.ts                   # zeal-tui plugin: assembly + lifecycle
      normalize.ts               # SessionEvent → ZealEvent (only raw-payload file)
      model.ts                   # view-model types
      store.ts                   # fold + interaction queue + coalesced notify
      editor.ts                  # pure input-editor reducer
      driver.ts                  # create/resume/send/cancel/model-switch/picker
      answerers.ts               # approval listener + question provider
      commands.ts                # slash-command adapter (seam + local)
      stdio.ts                   # stderr/console → logfile redirection
      ui/App.tsx                 # root layout
      ui/Transcript.tsx          # <Static> settled + live tail
      ui/Markdown.tsx            # marked lexer → Ink Text
      ui/ToolPanel.tsx           # tool call/result, subagent nesting
      ui/StatusBar.tsx
      ui/InputEditor.tsx         # Ink wrapper over editor.ts
      ui/InteractionPanel.tsx    # approval + questions + plan-review variants
  tests/                         # mirrors src; composition/ holds integration
packages/zeal/
  package.json                   # bin: zeal
  src/main.ts
  tests/bootstrap.test.ts
gauntlet/
  overlay.cordis.yml             # disables TUI rows, mounts gauntlet-runner
  run.sh                         # profile setup + one task execution
  tasks/g1-fix-test/{task.txt,repo/,verify.sh}   # …g2–g8 same shape
GAUNTLET.md
```

---

### Task 1: Workspace scaffold and pinned dependencies

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `packages/dsh-zeal/package.json`, `packages/dsh-zeal/tsconfig.json`, `packages/zeal/package.json`, `packages/zeal/tsconfig.json`, `.gitignore`

**Interfaces:**
- Produces: workspace where `pnpm install`, `pnpm build`, `pnpm test` run; the bundle package manifest whose `exports`/`dsh.bundle` later tasks rely on.

- [ ] **Step 1: Root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`package.json` (root):
```json
{
  "name": "zeal-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsdown": "^0.12.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2023",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    environment: 'node',
  },
})
```

`.gitignore`: `node_modules/`, `lib/`, `*.tsbuildinfo`, `.sessions/`

- [ ] **Step 2: Bundle package manifest.** First run `npm view @deepseek-ai/dsh-code-runtime-worker-thread version` (and for every `@deepseek-ai` package below) and pin exactly what npm reports; the values shown are the ones verified 2026-08-14.

`packages/dsh-zeal/package.json`:
```json
{
  "name": "@zealagent/dsh-zeal",
  "version": "0.1.0",
  "type": "module",
  "description": "Zeal: GLM-powered terminal coding agent bundle for DeepSeek Harness",
  "engines": { "node": ">=22" },
  "exports": {
    ".": { "types": "./lib/startup.d.ts", "default": "./lib/startup.js" },
    "./startup": { "types": "./lib/startup.d.ts", "default": "./lib/startup.js" },
    "./tui": { "types": "./lib/tui/index.d.ts", "default": "./lib/tui/index.js" },
    "./gauntlet-runner": { "types": "./lib/gauntlet-runner.d.ts", "default": "./lib/gauntlet-runner.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],
  "scripts": { "build": "tsdown src/startup.ts src/gauntlet-runner.ts src/tui/index.ts --dts --format esm --out-dir lib" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/schemastery": "3.18.1",
    "@deepseek-ai/dsh-agent": "0.1.0-rc.6",
    "@deepseek-ai/dsh-cmdline": "0.0.1-rc.1",
    "@deepseek-ai/dsh-code-runtime-worker-thread": "0.0.1-rc.3",
    "@deepseek-ai/dsh-commands": "0.0.1-rc.1",
    "@deepseek-ai/dsh-llm": "0.0.1-rc.1",
    "@deepseek-ai/dsh-session": "0.0.1-rc.1",
    "@deepseek-ai/dsh-session-query": "0.0.1-rc.1",
    "@deepseek-ai/dsh-user-approval": "0.0.1-rc.1",
    "@deepseek-ai/dsh-user-questions": "0.0.1-rc.3",
    "commander": "^13.0.0",
    "ink": "^7.1.1",
    "marked": "^18.0.9",
    "react": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "fast-check": "^4.9.0",
    "ink-testing-library": "^4.0.0",
    "yaml": "^2.6.0"
  }
}
```
Note (verified 2026-08-14): `@deepseek-ai/cordis@4.0.1` and `@deepseek-ai/schemastery@3.18.1` are published standalone. After the first install, open `node_modules/@deepseek-ai/dsh-agent/package.json` and align our `cordis`/`schemastery` pins to the exact versions the dsh packages themselves resolve — two live copies of cordis would mean two `Context` identities and broken service keys; pnpm's hoisted profile layout dedupes only when the versions agree.

`packages/dsh-zeal/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "tests"] }
```

- [ ] **Step 3: Launcher package manifest.**

`packages/zeal/package.json`:
```json
{
  "name": "@zealagent/zeal",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": { "zeal": "./lib/main.js" },
  "files": ["lib"],
  "scripts": { "build": "tsdown src/main.ts --format esm --out-dir lib" },
  "dependencies": { "@deepseek-ai/dsh": "0.1.0-rc.6" }
}
```
`packages/zeal/tsconfig.json`: same one-liner extends as above.

- [ ] **Step 4: Install and verify.** Run: `pnpm install` → succeeds; `pnpm test` → "no tests" pass; `pnpm typecheck` → passes (no sources yet is fine).

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(zeal): workspace scaffold with pinned dsh dependencies"`

---

### Task 2: Bundle patch layer (`cordis.patch.yml`) with unit test

**Files:**
- Create: `packages/dsh-zeal/cordis.patch.yml`, `packages/dsh-zeal/tests/patch.test.ts`

**Interfaces:**
- Produces: the patch every later runtime task boots under. Row ids used later: `llm-pi-ai`, `agent-default-model`, `zeal-startup`, `zeal-tui`.

- [ ] **Step 1: Write the failing test** — parse the YAML and assert the spec §4 invariants:

`packages/dsh-zeal/tests/patch.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const path = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
type Row = { id?: string; name?: string; disabled?: boolean; config?: any; insert?: Row[] }
const rows: Row[] = parse(readFileSync(path, 'utf8'))
const byId = new Map(rows.filter(r => r.id).map(r => [r.id!, r]))
const inserted = rows.flatMap(r => r.insert ?? [])

describe('zeal patch invariants (spec §4)', () => {
  it('retargets llm-pi-ai with both zai routes', () => {
    const cfg = byId.get('llm-pi-ai')!.config
    expect(Object.keys(cfg.providers)).toEqual(['zai', 'zai-coding-cn'])
    expect(cfg.providers['zai'].apiKeyEnv).toBe('ZAI_API_KEY')
    expect(cfg.providers['zai-coding-cn'].apiKeyEnv).toBe('ZHIPU_API_KEY')
  })
  it('retargets the default model to zai/glm-5.2', () => {
    expect(byId.get('agent-default-model')!.config).toEqual({ provider: 'zai', model: 'glm-5.2' })
  })
  it('disables deepseek adapter, hmr, telemetry, and web search', () => {
    for (const id of ['llm-deepseek', 'hmr', 'session-telemetry-otel', 'web-search-deepseek', 'tool-web']) {
      expect(byId.get(id)?.disabled, id).toBe(true)
    }
  })
  it('inserts code-runtime and the two zeal plugins', () => {
    const names = inserted.map(r => r.name)
    expect(names).toContain('@deepseek-ai/dsh-code-runtime-worker-thread')
    expect(names).toContain('@zealagent/dsh-zeal/startup')
    expect(names).toContain('@zealagent/dsh-zeal/tui')
  })
  it('sets the Zeal persona', () => {
    expect(byId.get('system-prompt')!.config.persona).toContain('Zeal')
  })
  it('names only packages that are bundle dependencies (spec V5 rule)', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    for (const row of inserted) {
      const bare = row.name!.startsWith('@') ? row.name!.split('/').slice(0, 2).join('/') : row.name!.split('/')[0]
      if (bare === '@zealagent/dsh-zeal') continue
      expect(pkg.dependencies, `row ${row.id} names ${bare}`).toHaveProperty(bare)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `pnpm vitest run packages/dsh-zeal/tests/patch.test.ts` → FAIL (file missing).

- [ ] **Step 3: Write the patch.**

`packages/dsh-zeal/cordis.patch.yml`:
```yaml
# Zeal bundle patch — rides over @deepseek-ai/dsh-base. A patch REPLACES the
# targeted row's whole config; every touched row is stated completely.

# Base mounts llm-pi-ai dormant; these entry-config routes bring it live.
# Settings-layer sections deep-merge per route and can add/override but never
# remove these (verified: llm-pi-ai dynamic-config tests).
- id: llm-pi-ai
  config:
    providers:
      zai:
        apiKeyEnv: ZAI_API_KEY
        reasoning: high
      zai-coding-cn:
        apiKeyEnv: ZHIPU_API_KEY
        reasoning: high

- id: agent-default-model
  config:
    provider: zai
    model: glm-5.2

- id: llm-deepseek
  disabled: true

# Ink owns the terminal; module-reload watching would fight it.
- id: hmr
  disabled: true

- id: session-telemetry-otel
  disabled: true

# Backend is DeepSeek's search API; a GLM user has no credential for it.
- id: web-search-deepseek
  disabled: true
- id: tool-web
  disabled: true

- id: system-prompt
  config:
    persona: >-
      You are Zeal, a coding agent powered by the {{model}} model. Your working
      directory is {{cwd}}. Verify your work by running the code or tests
      before declaring it done. Prefer editing existing files over rewriting
      them. Keep answers brief and factual.

- insert:
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'
    - id: zeal-startup
      name: '@zealagent/dsh-zeal/startup'
    - id: zeal-tui
      name: '@zealagent/dsh-zeal/tui'
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): bundle patch layer with invariant tests"`

---

### Task 3: `zeal-startup` plugin

**Files:**
- Create: `packages/dsh-zeal/src/startup.ts`, `packages/dsh-zeal/tests/startup.test.ts`

**Interfaces:**
- Consumes: `ctx.cmdlineArgs.get(): string[]` and `parseCmdline(ctx, program)` from `@deepseek-ai/dsh-cmdline` (mirror `$DSH_SRC/packages/bundle/headless/src/startup.ts` — copy its commander wiring shape exactly).
- Produces: service `ctx.zealStartup: ZealStartupValues` where `interface ZealStartupValues { resumeSessionId?: string; model?: string }`. Task 10 (driver) and Task 11 (assembly) consume this.

- [ ] **Step 1: Write the failing test.** The plugin's parsing core must be a pure exported function so tests need no Cordis boot:

`packages/dsh-zeal/tests/startup.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseZealArgs } from '../src/startup.ts'

describe('parseZealArgs', () => {
  it('parses --resume and --model', () => {
    expect(parseZealArgs(['--resume', 'session-abc', '--model', 'glm-4.7']))
      .toEqual({ resumeSessionId: 'session-abc', model: 'glm-4.7' })
  })
  it('returns empty values for no args', () => {
    expect(parseZealArgs([])).toEqual({})
  })
  it('throws on unknown flags', () => {
    expect(() => parseZealArgs(['--bogus'])).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `pnpm vitest run packages/dsh-zeal/tests/startup.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

`packages/dsh-zeal/src/startup.ts`:
```ts
import type { Context } from '@deepseek-ai/cordis'
import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

export const name = 'zeal-startup'
export const inject = ['cmdlineArgs']

export interface ZealStartupValues {
  resumeSessionId?: string
  model?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context { zealStartup: ZealStartupValues }
}

export function parseZealArgs(args: string[]): ZealStartupValues {
  const program = new Command('zeal')
    .exitOverride()                       // throw instead of process.exit in tests
    .option('--resume <sessionId>', 'resume a persisted session')
    .option('--model <id>', 'initial model id on the default route')
    .allowExcessArguments(false)
  program.parse(args, { from: 'user' })
  const opts = program.opts<{ resume?: string; model?: string }>()
  const values: ZealStartupValues = {}
  if (opts.resume !== undefined) values.resumeSessionId = opts.resume
  if (opts.model !== undefined) values.model = opts.model
  return values
}

function valuesFromOpts(opts: { resume?: string; model?: string }): ZealStartupValues {
  const values: ZealStartupValues = {}
  if (opts.resume !== undefined) values.resumeSessionId = opts.resume
  if (opts.model !== undefined) values.model = opts.model
  return values
}

export function apply(ctx: Context): void {
  // Mirror dsh-headless/startup: commander owns --help and parse errors,
  // parseCmdline binds the program to the launcher-provided argument snapshot
  // (ctx.cmdlineArgs) — never touch process.argv here. The action fires after
  // commander parsed that snapshot, so it reads program.opts() directly.
  const program = new Command('zeal')
    .option('--resume <sessionId>', 'resume a persisted session')
    .option('--model <id>', 'initial model id on the default route')
  program.action(() => {
    ctx.provide('zealStartup', valuesFromOpts(program.opts()))
  })
  parseCmdline(ctx, program)
}
```
Refactor `parseZealArgs` to delegate to `valuesFromOpts` so the pure, tested core and `apply` share one mapping. Before wiring, compare against `$DSH_SRC/packages/bundle/headless/src/startup.ts:49-60` and match its `parseCmdline` arrangement exactly.

- [ ] **Step 4: Run to verify it passes**, plus `pnpm typecheck`.

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): startup plugin parsing --resume/--model"`

---

### Task 4: Event normalization (`normalize.ts`)

**Files:**
- Create: `packages/dsh-zeal/src/tui/normalize.ts`, `packages/dsh-zeal/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` from `@deepseek-ai/dsh-session`. Authoritative vocabulary: `$DSH_SRC/packages/core/session/src/types.ts` (the `SessionEventMap`); verified fields: `assistant/chunk` = `{ turn, step, chunk: StreamChunk }` (types.ts:266), `assistant/message` = `{ message }` with `message.content: ContentBlock[]`, `turn/end` = `{ reason }` with `reason.kind ∈ completed|aborted|error…`, `request/header` = `{ header }` with `header.config.provider/model`.
- Produces (everything downstream consumes ONLY this):
```ts
export type ZealEvent =
  | { t: 'turn-start'; seq: number }
  | { t: 'text-delta'; seq: number; text: string }
  | { t: 'reasoning-delta'; seq: number; text: string }
  | { t: 'user-message'; seq: number; text: string }
  | { t: 'assistant-message'; seq: number; text: string; reasoning: string }
  | { t: 'tool-call'; seq: number; callId: string; name: string; args: string }
  | { t: 'tool-result'; seq: number; callId: string; ok: boolean; preview: string }
  | { t: 'request-header'; seq: number; provider: string; model: string }
  | { t: 'turn-end'; seq: number; outcome: 'completed' | 'aborted' | 'error'; errorCode?: string; errorMessage?: string }
  | { t: 'other'; seq: number }
export function normalizeEvent(event: SessionEvent): ZealEvent
export function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string   // joins 'text' blocks
```

- [ ] **Step 1: Open `$DSH_SRC/packages/core/session/src/types.ts` and transcribe** the exact payload field names for: `turn/start`, `assistant/chunk` (and the `StreamChunk` delta shape from `$DSH_SRC/packages/llm/llm/src/types.ts` — text vs reasoning deltas), `assistant/message`, the user-message event type (find how `createUserMessage` appends land — likely `user/message` or a `message` event; use what types.ts says), `tool/call`, `tool/result`, `request/header`, `turn/end`. Record them as a comment block at the top of `normalize.ts`.

- [ ] **Step 2: Write the failing test** with fixture events built to the transcribed shapes:

`packages/dsh-zeal/tests/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { normalizeEvent } from '../src/tui/normalize.ts'
import { fixtures } from './fixtures/events.ts'   // create in this step

describe('normalizeEvent', () => {
  it('maps a text stream chunk to text-delta', () => {
    expect(normalizeEvent(fixtures.textChunk('hi', 7))).toEqual({ t: 'text-delta', seq: 7, text: 'hi' })
  })
  it('maps a reasoning chunk to reasoning-delta', () => {
    expect(normalizeEvent(fixtures.reasoningChunk('mm', 8))).toEqual({ t: 'reasoning-delta', seq: 8, text: 'mm' })
  })
  it('maps tool call and result with callId correlation', () => {
    expect(normalizeEvent(fixtures.toolCall('call_1', 'bash', '{"cmd":"ls"}', 9)))
      .toEqual({ t: 'tool-call', seq: 9, callId: 'call_1', name: 'bash', args: '{"cmd":"ls"}' })
    const r = normalizeEvent(fixtures.toolResult('call_1', false, 'file1\nfile2', 10))
    expect(r).toMatchObject({ t: 'tool-result', callId: 'call_1', ok: true })
  })
  it('maps turn/end reasons to outcomes', () => {
    expect(normalizeEvent(fixtures.turnEnd('completed', 11))).toMatchObject({ t: 'turn-end', outcome: 'completed' })
    expect(normalizeEvent(fixtures.turnEnd('aborted', 12))).toMatchObject({ t: 'turn-end', outcome: 'aborted' })
  })
  it('passes unknown events through as other', () => {
    expect(normalizeEvent(fixtures.unknown(13))).toEqual({ t: 'other', seq: 13 })
  })
})
```
`tests/fixtures/events.ts` builds objects exactly matching the transcribed `SessionEventMap` shapes (cast through `as unknown as SessionEvent` where brands demand it) — this file is the single place fixtures encode raw shapes.

- [ ] **Step 3: Run to verify it fails.** → FAIL.

- [ ] **Step 4: Implement `normalize.ts`** — a `switch (event.type)` over the transcribed vocabulary; unknown types → `{ t: 'other', seq }`. `preview` for tool results: `textOf(content).slice(0, 2000)`; `ok: !isError`.

- [ ] **Step 5: Run to verify it passes.** Also `pnpm typecheck` — this is the task that proves our pinned `@deepseek-ai/dsh-session` types actually compile.

- [ ] **Step 6: Commit.** `git commit -am "feat(zeal): session-event normalization layer"`

---

### Task 5: Transcript store — fold + view model

**Files:**
- Create: `packages/dsh-zeal/src/tui/model.ts`, `packages/dsh-zeal/src/tui/store.ts`, `packages/dsh-zeal/tests/store.test.ts`

**Interfaces:**
- Consumes: `ZealEvent`/`normalizeEvent` (Task 4).
- Produces:

`model.ts`:
```ts
export interface UserEntry { kind: 'user'; seq: number; text: string }
export interface AssistantEntry { kind: 'assistant'; seq: number; text: string; reasoning: string }
export interface ToolEntry {
  kind: 'tool'; seq: number; callId: string; name: string; args: string
  status: 'running' | 'ok' | 'error'; preview: string
}
export interface NoticeEntry { kind: 'notice'; seq: number; level: 'info' | 'error'; text: string }
export type TranscriptEntry = UserEntry | AssistantEntry | ToolEntry | NoticeEntry

export interface LiveTurn { text: string; reasoning: string; tools: ToolEntry[] }
export interface StatusModel {
  provider: string; model: string; title?: string; running: boolean
  sandboxMode?: string; retry?: string; contextFill?: number
}
export interface ZealViewState {
  settled: readonly TranscriptEntry[]
  live?: LiveTurn
  interaction?: PendingInteraction        // defined in Task 6
  status: StatusModel
}
```

`store.ts`:
```ts
export class ZealStore {
  constructor(initialStatus: { provider: string; model: string })
  getState(): ZealViewState
  subscribe(listener: () => void): () => void     // notifications coalesced ~16ms
  apply(event: SessionEvent): void                // normalize + fold; drops seq <= lastSeq
  addNotice(level: 'info' | 'error', text: string): void
  setStatus(patch: Partial<StatusModel>): void
}
```

**Fold semantics** (the test spec): `turn-start` → `live = {text:'',reasoning:'',tools:[]}`, `status.running = true`. `text-delta`/`reasoning-delta` append to live. `tool-call` → running ToolEntry in `live.tools`. `tool-result` → matching tool settles into `settled` (status ok/error, preview) and leaves `live.tools`. `assistant-message` → settle an AssistantEntry with the message's full text (and reset `live.text`/`live.reasoning` — the message is the authoritative assembly). `user-message` → settle UserEntry. `turn-end` → any still-running live tools settle as-is, remaining live text settles if nonempty, `live = undefined`, `running = false`; outcome `error` adds a NoticeEntry with the message; `aborted` adds `notice('info','turn interrupted')`. `request-header` → `setStatus({provider, model})`. Duplicate/lower `seq` events are ignored (idempotent resume replay).

- [ ] **Step 1: Write failing example-based tests** covering each rule above (one `it` per rule; build sequences from Task 4's fixtures and drive `store.apply`).

- [ ] **Step 2: Add the fast-check property tests** in the same file:
```ts
import fc from 'fast-check'
import { eventSequence } from './fixtures/arbitraries.ts'  // arbitrary well-formed turn sequences

it('re-applying any prefix is a no-op (idempotence under replay)', () => {
  fc.assert(fc.property(eventSequence(), (events) => {
    const a = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    for (const e of events) a.apply(e)
    const before = JSON.stringify(a.getState())
    for (const e of events) a.apply(e)               // full replay: all seqs stale
    expect(JSON.stringify(a.getState())).toBe(before)
  }))
})
it('settled entries only grow, in seq order', () => {
  fc.assert(fc.property(eventSequence(), (events) => {
    const s = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    let prev = 0
    for (const e of events) {
      s.apply(e)
      const n = s.getState().settled.length
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
    const seqs = s.getState().settled.map(x => x.seq)
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs)
  }))
})
```
`arbitraries.ts`: generates 1–3 turns; each turn = turn-start, interleaved deltas, 0–3 tool call/result pairs, an assistant-message, turn-end; seq strictly increasing.

- [ ] **Step 3: Run to verify both fail.** → FAIL.

- [ ] **Step 4: Implement `model.ts` + `store.ts`.** Immutable state swaps (`this.state = {...}`); `subscribe` uses a `setTimeout(notify, 16)` coalescer with an `unref()`d timer; `apply` guards `if (seq <= this.lastSeq) return` then folds.

- [ ] **Step 5: Run to verify all pass.**

- [ ] **Step 6: Commit.** `git commit -am "feat(zeal): transcript store with property-tested fold"`

---

### Task 6: Interaction queue in the store

**Files:**
- Modify: `packages/dsh-zeal/src/tui/model.ts`, `packages/dsh-zeal/src/tui/store.ts`
- Create: `packages/dsh-zeal/tests/interactions.test.ts`

**Interfaces:**
- Produces (consumed by answerers Task 12/13 and `InteractionPanel` Task 9):
```ts
// model.ts additions
export interface ApprovalPrompt { kind: 'approval'; id: number; title: string; detail: string; agentLabel: string }
export interface QuestionOption { label: string; description?: string }
export interface QuestionItem {
  id: string; question: string; detail?: string; header?: string
  options: QuestionOption[]; multiSelect: boolean; planReview: boolean
}
export interface QuestionsPrompt { kind: 'questions'; id: number; items: QuestionItem[] }
export type PendingInteraction = ApprovalPrompt | QuestionsPrompt
export type ApprovalDecision = 'allow-once' | 'reject'
export interface QuestionAnswer { id: string; selected: string[]; custom?: string }

// store.ts additions
askApproval(input: Omit<ApprovalPrompt, 'kind' | 'id'>, signal?: AbortSignal): Promise<ApprovalDecision>
askQuestions(items: QuestionItem[], signal?: AbortSignal): Promise<QuestionAnswer[]>
resolveInteraction(id: number, result: ApprovalDecision | QuestionAnswer[]): void
```
Semantics: requests queue FIFO; `state.interaction` shows the head; `resolveInteraction` settles its promise and promotes the next; an aborted signal rejects the promise with the signal's reason and removes the request (head or queued).

- [ ] **Step 1: Write failing tests**: (a) `askApproval` surfaces the prompt in state and resolves with the decision passed to `resolveInteraction`; (b) two concurrent requests are served FIFO; (c) aborting a queued request removes it without disturbing the head; (d) aborting the head promotes the next.

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): interaction queue with abort semantics"`

---

### Task 7: Markdown renderer

**Files:**
- Create: `packages/dsh-zeal/src/tui/ui/Markdown.tsx`, `packages/dsh-zeal/tests/ui/markdown.test.tsx`

**Interfaces:**
- Produces: `export function Markdown(props: { source: string; width: number }): JSX.Element` — renders headings (bold underline), paragraphs (wrapped), fenced code (dim background block, no wrap, horizontal truncate to width), inline code (cyan), bold/italic, ordered/unordered lists (2-space indent, `•`/`n.`), blockquotes (`│ ` prefix). Uses `marked`'s **lexer only** (`marked.lexer(source)`) — no HTML path.

- [ ] **Step 1: Write failing tests** with `ink-testing-library` at width 80:
```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/tui/ui/Markdown.tsx'

it('renders a heading, list, and code fence', () => {
  const { lastFrame } = render(<Markdown width={80} source={'# Title\n\n- one\n- two\n\n```js\nconst a = 1\n```'} />)
  const frame = lastFrame()!
  expect(frame).toContain('Title')
  expect(frame).toContain('• one')
  expect(frame).toContain('const a = 1')
})
it('never exceeds the given width', () => {
  const long = 'x'.repeat(500)
  const { lastFrame } = render(<Markdown width={40} source={long} />)
  for (const line of lastFrame()!.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — walk `marked.lexer` tokens, map to `<Text>`/`<Box flexDirection="column">`; snapshot-free assertions keep this robust. **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): markdown-to-ink renderer"`

---

### Task 8: Transcript UI (settled + live tail + tool panels)

**Files:**
- Create: `packages/dsh-zeal/src/tui/ui/Transcript.tsx`, `packages/dsh-zeal/src/tui/ui/ToolPanel.tsx`, `packages/dsh-zeal/tests/ui/transcript.test.tsx`

**Interfaces:**
- Consumes: `ZealViewState` (Task 5), `Markdown` (Task 7).
- Produces: `export function Transcript(props: { state: ZealViewState; width: number }): JSX.Element`. Settled entries render inside Ink `<Static items={state.settled}>` keyed by `seq`; the live turn renders below it (streaming text via `Markdown`, dim italic reasoning ABOVE the text, running tools as `ToolPanel` with a spinner glyph `…`). `ToolPanel`: one line `▸ name(argsPreview) — status`, plus up to 6 preview lines when settled with error, 2 when ok; a tool named `subagent`/`subagent_fork` renders its preview indented as a nested child block (spec: subagent activity surfaces through parent tool events).

- [ ] **Step 1: Write failing frame tests** (width 80): (a) a settled user + assistant pair appears in order; (b) a running tool shows `…` and its name; (c) a settled error tool shows its preview lines; (d) a `subagent` tool renders indented preview; (e) live reasoning renders before live text.

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): transcript rendering with static region and tool panels"`

---

### Task 9: StatusBar and InteractionPanel

**Files:**
- Create: `packages/dsh-zeal/src/tui/ui/StatusBar.tsx`, `packages/dsh-zeal/src/tui/ui/InteractionPanel.tsx`, `packages/dsh-zeal/tests/ui/statusbar.test.tsx`, `packages/dsh-zeal/tests/ui/interaction.test.tsx`

**Interfaces:**
- Consumes: `StatusModel`, `PendingInteraction`, store resolve methods (Task 6).
- Produces:
  - `StatusBar(props: { status: StatusModel; width: number })` — single inverse-video line: `zeal · {provider}/{model} · {title ?? 'new session'} · {running ? '⏵ running (esc interrupts)' : 'idle'} · {sandboxMode ?? ''} · {retry ?? ''} · ctx {Math.round(contextFill*100)}%` (omit absent segments; NEVER a dollar amount — spec N1).
  - `InteractionPanel(props: { interaction: PendingInteraction; onResolve: (id: number, result: ApprovalDecision | QuestionAnswer[]) => void })` — approval variant: title, detail, `[y] allow once  [n] reject`; questions variant: numbered options, space toggles under multiSelect, enter submits, `c` opens free-text custom answer; **plan-review variant** (any item with `planReview`): framed header `PLAN REVIEW`, options rendered as `[a] approve plan  [r] request changes` mapping to the intent's approve option vs the remainder.

- [ ] **Step 1: Write failing frame tests**: status line contains model + running hint; approval panel shows y/n; plan-review item renders the framed variant; keyboard: simulate `stdin.write('y')` resolves approval `allow-once` (use ink-testing-library's `stdin`).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** (`useInput` in `InteractionPanel` only — it is mounted only when an interaction is pending, so it never steals keys from the editor). **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): status bar and interaction panels incl. plan review"`

---

### Task 10: Input editor (pure reducer + Ink wrapper)

**Files:**
- Create: `packages/dsh-zeal/src/tui/editor.ts`, `packages/dsh-zeal/src/tui/ui/InputEditor.tsx`, `packages/dsh-zeal/tests/editor.test.ts`

**Interfaces:**
- Produces:
```ts
// editor.ts — pure, fully unit-tested; the A6 boundary lives here
export interface EditorState {
  lines: string[]; row: number; col: number
  history: string[]; historyCursor?: number
}
export type EditorAction =
  | { type: 'insert'; text: string }        // printable input incl. paste payloads
  | { type: 'backspace' } | { type: 'delete-word' }
  | { type: 'newline' }                     // bound to alt+enter / ctrl+j ONLY (spec A6)
  | { type: 'left' } | { type: 'right' } | { type: 'up' } | { type: 'down' }
  | { type: 'home' } | { type: 'end' }
  | { type: 'history-prev' } | { type: 'history-next' }
  | { type: 'submit' }                      // returns text via reduce result
export interface ReduceResult { state: EditorState; submitted?: string }
export function emptyEditor(history?: string[]): EditorState
export function editorReduce(state: EditorState, action: EditorAction): ReduceResult
export function stripPasteMarkers(input: string): string  // removes \x1b[200~ / \x1b[201~
```
`InputEditor.tsx`: `useInput` maps keys → actions (`return` → submit; `alt+return`/`ctrl+j` → newline; arrows; `ctrl+w` delete-word; up/down = cursor move within multiline, history only when on row 0 col 0 / last row end), calls `props.onSubmit(text)`; multi-char `input` values are treated as paste after `stripPasteMarkers`. Out of scope, per spec: IME guarantees, kill-ring.

- [ ] **Step 1: Write failing reducer tests** (pure, no Ink): typing builds a line; newline splits at cursor; backspace joins lines at col 0; history-prev/next replace buffer and restore the draft; submit trims trailing newline, appends to history, resets buffer; paste with CRLF normalizes to `\n`; `stripPasteMarkers` removes bracketed-paste frames.

- [ ] **Step 2: Run → FAIL. Step 3: Implement `editor.ts`. Step 4: Run → PASS.**

- [ ] **Step 5: Add one Ink-level test**: render `InputEditor`, `stdin.write('hi')`, `stdin.write('\r')` → `onSubmit` called with `'hi'`. Run → PASS.

- [ ] **Step 6: Commit.** `git commit -am "feat(zeal): bounded v1 input editor"`

---

### Task 11: Slash-command adapter

**Files:**
- Create: `packages/dsh-zeal/src/tui/commands.ts`, `packages/dsh-zeal/tests/commands.test.ts`

**Interfaces:**
- Consumes: `ctx.commands` seam — verified contract: `list(agent)` → name-sorted descriptors `{ name, description, … }`; `execute(agent, line, signal)` → `Promise<CommandExecution | undefined>` (`undefined` = invalid syntax or unknown name; result carries outcome + optional UI text). Driver (Task 12) for local commands.
- Produces:
```ts
export interface LocalCommand { name: string; description: string; run(input: string): Promise<string | undefined> }
export interface CommandOutcome { handled: boolean; uiText?: string }
export class CommandDispatcher {
  constructor(opts: {
    seam?: { list(agent: unknown): ReadonlyArray<{ name: string; description: string }>
             execute(agent: unknown, line: string, signal?: AbortSignal): Promise<{ result?: { text?: string } } | undefined> }
    agent?: unknown
    locals: LocalCommand[]
  })
  isCommand(line: string): boolean                       // starts with '/'
  completions(prefix: string): string[]                  // merged seam + local names
  dispatch(line: string, signal?: AbortSignal): Promise<CommandOutcome>
  // order: local name match first (so /model, /resume, /help, /quit always work),
  // then seam.execute; seam undefined result → { handled: false }
}
export function helpText(d: CommandDispatcher): string
```
The seam types above are structural on purpose — `commands.ts` and the assembly task pass the real `ctx.commands`/`Agent` straight through; align parameter shapes with `$DSH_SRC/packages/interaction/commands/README.md` when wiring.

- [ ] **Step 1: Write failing tests** with a fake seam: local `/help` wins; `/compact …` routes to seam and returns its text; unknown `/nope` → `{handled:false}`; `completions('/c')` merges both sources; non-slash line → `isCommand` false.

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): slash-command dispatcher over the commands seam"`

---

### Task 12: Turn driver

**Files:**
- Create: `packages/dsh-zeal/src/tui/driver.ts`, `packages/dsh-zeal/tests/driver.test.ts`

**Interfaces:**
- Consumes (all verified — spec §7 Resolutions): `ctx.agents.create({ sessionId, meta, agentOptions, setup })` / `ctx.agents.resume({ resumeSessionId, agentOptions, setup })` → `{ agent }`; `installModelSelection(agentCtx, ref)` + `agentDefaultModel.currentSelection()`; `agent.followup(createUserMessage({ content, source: { kind: 'user' } }))`; `agent.cancel({ kind: 'user' }, { keepInbox: true })`; `agent.whenIdle()`; `agent.session.events` + `agent.session.firstLiveSeq`; `agentCtx.on('session/event', (session, event) => …)`; `ctx.sessionQuery.listSessions()` + `readTitleSnapshots(ids)`; `ctx.sessions.flush(agent.session)`. Copy exact call shapes from `$DSH_SRC/packages/bundle/headless/src/index.ts:96-128` (create/followup/whenIdle) and `$DSH_SRC/examples/headless-agent/tests/resume.e2e.ts:54` (resume).
- Produces:
```ts
export interface PickerRow { sessionId: string; title?: string; createdAt: number; live: boolean }
export class ZealDriver {
  static async start(ctx: Context, store: ZealStore, opts: { resumeSessionId?: string; model?: string }): Promise<ZealDriver>
  send(text: string): void                     // followup; store shows the user entry via session events
  interrupt(): void                            // cancel({kind:'user'},{keepInbox:true})
  switchModel(model: string, provider?: string): void   // mutates the selection ref (next step picks it up)
  listSessions(limit?: number): Promise<PickerRow[]>
  flush(): Promise<void>
  readonly agent: { whenIdle(): Promise<void> }
}
```
`start` behavior: awaits `ctx.get('loader')?.await()`; builds the selection ref from `agentDefaultModel.currentSelection()` overridden by `opts.model`; in `setup(agentCtx)` calls `installModelSelection` AND registers the scoped `session/event` listener piping into `store.apply`; on resume, after the handle returns, replays `agent.session.events` (the store's seq guard makes overlap safe).

- [ ] **Step 1: Write failing tests against a hand-rolled fake registry** implementing the consumed signatures (fake agent records `followup`/`cancel` calls; fake session with an `events` array; fake `sessionQuery`): (a) `start` installs the model selection and subscribes before returning; (b) `send` wraps text in a user message; (c) `interrupt` calls cancel with `{kind:'user'},{keepInbox:true}`; (d) resume replays seed events into the store exactly once; (e) `listSessions` merges titles onto rows.

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**, `pnpm typecheck` (compiles against real dsh types).

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): turn driver over verified registry APIs"`

---

### Task 13: Answerers (approval + user questions)

**Files:**
- Create: `packages/dsh-zeal/src/tui/answerers.ts`, `packages/dsh-zeal/tests/answerers.test.ts`

**Interfaces:**
- Consumes: store `askApproval`/`askQuestions` (Task 6). Seam contracts: approval = waterfall listener on `'approval/request'` returning `'allowed-once' | 'rejected' | 'cancelled'` or delegating via `next()` — transcribe the exact listener signature and request fields from the generated region of `$DSH_SRC/docs/subsystems/approval.md#cordis-surface` before implementing; questions = `ctx.userQuestions.registerProvider({ ask(request) })` with `AskUserQuestionRequest`/`AskUserQuestionAnswer` from `@deepseek-ai/dsh-user-questions` (fields verified: `questions[].{id,question,detail?,header?,options?,multiSelect?,intent?}`, `intent.kind === 'plan-review'`; answer `{ answers: [{ id, selected, custom? }] }`).
- Produces:
```ts
export function registerZealAnswerers(ctx: Context, store: ZealStore): void
// - global approval listener: maps request → store.askApproval({title, detail, agentLabel}),
//   'allow-once' → 'allowed-once', 'reject' → 'rejected'; store abort → 'cancelled'
// - question provider: maps request.questions → QuestionItem[] (planReview =
//   intent?.kind === 'plan-review'), answers back verbatim {id, selected, custom}
export function mapQuestions(request: AskUserQuestionRequest): QuestionItem[]   // pure, exported for tests
export function mapAnswers(items: QuestionItem[], answers: QuestionAnswer[]): AskUserQuestionAnswer
```

- [ ] **Step 1: Write failing tests** for the pure mappers (plan-review flag set; options default to `[]` + multiSelect false; answers round-trip ids) and for the registration wiring using a fake ctx exposing `on`/`userQuestions.registerProvider` (approval decision flows through the store to the listener's return value).

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): approval answerer and question provider"`

---

### Task 14: `zeal-tui` plugin assembly

**Files:**
- Create: `packages/dsh-zeal/src/tui/index.ts`, `packages/dsh-zeal/src/tui/stdio.ts`, `packages/dsh-zeal/src/tui/ui/App.tsx`, `packages/dsh-zeal/tests/ui/app.test.tsx`, `packages/dsh-zeal/tests/stdio.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the mounted plugin. `App` props: `{ store: ZealStore; driver: ZealDriver; dispatcher: CommandDispatcher; onQuit(): void }`.

- [ ] **Step 1: `stdio.ts` with test.** `export function redirectDiagnostics(logPath: string): () => void` — appends `process.stderr.write` and `console.log/warn/error` output to `logPath` (creating parent dirs), returns a restore function. Test: call it with a temp path, `console.error('x')`, restore, assert file contains `x` and stderr is restored.

- [ ] **Step 2: `App.tsx`.** Layout: `<Transcript>` + `<InteractionPanel>` (when pending) + `<InputEditor>` (hidden while interaction pending) + `<StatusBar>`. Global `useInput`: `escape` → `driver.interrupt()`; Ctrl+C pressed twice within 1.5s → `onQuit()` (first press shows `press ctrl+c again to quit` in the status line). Submit routing: `dispatcher.isCommand(line)` → `dispatch` (render `uiText` as a NoticeEntry; `/quit` → `onQuit()`; `/model <id>` → `driver.switchModel`; `/resume` → render picker from `driver.listSessions()`, selection restarts the driver via a callback prop); otherwise `driver.send(line)`. Frame test: render with fakes, type a line, assert it reaches the fake driver; type `/help`, assert notice appears.

- [ ] **Step 3: `index.ts`** — the Cordis plugin:
```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'zeal-tui'
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'userQuestions', 'commands', 'sessionQuery', 'cmdlineArgs', 'appExit', 'zealStartup']

export interface Config { logFile?: string }
export const Config: z<Config> = z.object({ logFile: z.string() })

export function apply(ctx: Context, config: Config): void {
  // Sequence: redirect diagnostics → build store → start driver → register
  // answerers → mount Ink (exitOnCtrlC: false, patchConsole: false) → on quit:
  // unmount, await driver.flush(), restore stdio, ctx.appExit(0).
  // MISSING_CREDENTIAL turn-end errors → store.addNotice('error', onboarding text
  // naming ZAI_API_KEY / ZHIPU_API_KEY and $DSH_HOME/.credentials.yaml).
  // sandbox mode: const mode = await ctx.get('sandboxPolicy')?.resolve({ session: driverSession })
  //   — optional service; omit the status segment when absent.
  // session title: poll ctx.get('sessionTitle')?.get(session) after each turn-end.
}
```
Implement exactly that sequence; the onboarding notice text is: `No API key found for the {route} route. Set {env} in your environment or add it to $DSH_HOME/.credentials.yaml, then retry. (A key configured in $DSH_HOME/settings.yaml under llm-pi-ai: also works.)`

- [ ] **Step 4: Run all package tests + typecheck → PASS.**

- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): tui plugin assembly with lifecycle and onboarding"`

---

### Task 15: Launcher (`@zealagent/zeal`)

**Files:**
- Create: `packages/zeal/src/main.ts`, `packages/zeal/tests/bootstrap.test.ts`

**Interfaces:**
- Produces: `zeal [args…]` bin. Pure core for tests:
```ts
export interface BootstrapPlan { needsInit: boolean; installArgs: string[]; launchArgs: string[] }
export function planBootstrap(opts: { dshHome: string; profileManifest?: { dependencies?: Record<string, string> }; argv: string[] }): BootstrapPlan
export function resolveDshBin(): string   // require.resolve('@deepseek-ai/dsh/package.json') → bin path
```
Behavior: `needsInit` when `$DSH_HOME/profiles/zeal/package.json` is missing or lacks `@zealagent/dsh-zeal` in dependencies; `installArgs = ['plugin', '--profile', 'zeal', 'add', '@zealagent/dsh-zeal', '@deepseek-ai/dsh-code-runtime-worker-thread']`; `launchArgs = ['--profile', 'zeal', ...argv]`. `main.ts` runs the plan with `spawnSync(process.execPath, [dshBin, ...installArgs], { stdio: 'inherit' })` then replaces itself via `spawnSync(process.execPath, [dshBin, ...launchArgs], { stdio: 'inherit' })` and exits with the child's code. `$DSH_HOME` default `~/.dsh`.

- [ ] **Step 1: Write failing tests** for `planBootstrap` (fresh home → init; manifest with dep → no init; argv passthrough) and `resolveDshBin` (returns an existing file).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(zeal): launcher bin with first-run profile bootstrap"`

---

### Task 16: Composition integration test (invariants + deliberate snapshot)

**Files:**
- Create: `packages/dsh-zeal/tests/composition/invariants.test.ts`, `packages/dsh-zeal/tests/composition/helpers.ts`, `packages/dsh-zeal/tests/composition/__snapshots__/` (generated)

**Interfaces:**
- Consumes: built bundle (`pnpm build` first), npm network. Gated: `describe.skipIf(!process.env.ZEAL_COMPOSITION)`.

- [ ] **Step 1: `helpers.ts`** — `setupProfile(tmpdir)`: `pnpm pack` the bundle into tmpdir; create `DSH_HOME=tmpdir/home`; run `pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile zeal add <tarball> @deepseek-ai/dsh-code-runtime-worker-thread` with `env DSH_HOME`; then `dumpConfig()`: run `… dsh --profile zeal --dump-config`, parse YAML, return rows.

- [ ] **Step 2: Write the two tests.** (a) **Invariants (must-pass):** same assertions as Task 2 but against the *composed* tree — additionally assert base rows survived (`agent-loop`, `tool-bash`, `tool-fs`, `subagent`, `tool-todo`, `skill`, `compaction-basic` present and enabled) and `llm-pi-ai` shows both routes. (b) **Full-tree snapshot (deliberate-update):** `expect(yamlStringify(rows)).toMatchSnapshot()` — CI runs it only when `ZEAL_COMPOSITION=1`; the snapshot diff is the §2.3 upgrade-review artifact.

- [ ] **Step 3: Run with the gate on** (`ZEAL_COMPOSITION=1 pnpm vitest run …`) → first run writes the snapshot; invariants PASS. Fix anything the real composition disproves (this task is where V5's hoisted-resolution guarantee gets exercised for real: the `zeal-tui`/`zeal-startup`/`code-runtime` rows must load).

- [ ] **Step 4: Commit** (including the snapshot). `git commit -am "test(zeal): composition invariants and upgrade snapshot"`

---

### Task 17: Gauntlet runner + overlay + G1

**Files:**
- Create: `packages/dsh-zeal/src/gauntlet-runner.ts`, `gauntlet/overlay.cordis.yml`, `gauntlet/run.sh`, `gauntlet/tasks/g1-fix-test/{task.txt,verify.sh,repo/…}`, `GAUNTLET.md`, `packages/dsh-zeal/tests/gauntlet-runner.test.ts`

**Interfaces:**
- Consumes: driver-pattern APIs (Task 12), store not needed. Mirrors `$DSH_SRC/packages/bundle/headless/src/index.ts` `run()` closely.
- Produces: `zeal-gauntlet-runner` plugin — config `{ task: string }`; creates one agent, registers **both machine substitutes** (spec A11+D1): a global `'approval/request'` listener returning `'allowed-once'`, and `userQuestions.registerProvider({ ask: async (req) => ({ answers: req.questions.map(q => ({ id: q.id, selected: [q.intent?.kind === 'plan-review' ? q.intent.approve : (q.options?.[0]?.label ?? 'yes')] })) }) })` (align the approve-option mapping with the real intent shape when transcribing); drives the task to quiescence, prints final assistant text, flushes, exits via `appExit` — copy the exit/error handling from the headless runner.

- [ ] **Step 1: Unit-test the machine question mapper** (plan-review picks the approve option; option-less questions answer `yes`). Run → FAIL → implement → PASS.

- [ ] **Step 2: `gauntlet/overlay.cordis.yml`:**
```yaml
- id: zeal-tui
  disabled: true
- id: zeal-startup
  disabled: true

# Store session logs uncompressed so verify.sh can grep them for tool events.
# A patch REPLACES the row's whole config, so root must be restated — copy the
# exact base value from $DSH_SRC/packages/bundle/base/cordis.patch.yml
# (root: !!js dshHomePath('sessions')). Base's default is zstd; grep on
# compressed frames silently matches nothing.
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none

- insert:
    - id: zeal-gauntlet-runner
      name: '@zealagent/dsh-zeal/gauntlet-runner'
      config:
        task: !!js process.env.ZEAL_TASK
```

- [ ] **Step 3: `gauntlet/run.sh`** — args: task dir. Creates a scratch `DSH_HOME`, sets up the `zeal` profile (Task 16 helper flow), appends the overlay to the profile's `cordis.patch.yml`, copies `repo/` to a scratch workdir, runs `ZEAL_TASK="$(cat task.txt)" dsh --profile zeal` from the workdir, then runs `verify.sh` (exit code = pass/fail). Bash, `set -euo pipefail`.

  **Isolation boundary (amended — see spec §5.2):** these scratch directories are the *whole* boundary. They are not a container, and the overlay's blanket `allowed-once` approval answerer means tool calls run with the invoking user's host privileges. Anything stronger (container execution with controlled mounts and explicit credential passing) is deliberately **out of scope for this step** — do not describe this runner as containerized. Revisit before running the gauntlet unattended or on untrusted task content.

- [ ] **Step 4: G1 content.** `repo/`: a 3-file TS project (`sum.ts` with an off-by-one bug: `return a + b + 1`; `sum.test.ts` expecting `sum(2,2) === 4`; `package.json` with vitest). `task.txt`: `The test suite in this repository fails. Find the bug, fix it, and run the tests to confirm they pass.` `verify.sh`: `cd "$WORKDIR" && npx vitest run`.

- [ ] **Step 5: Run G1 with a real key** (`gauntlet/run.sh gauntlet/tasks/g1-fix-test`) → verify.sh exits 0. Record the result row in `GAUNTLET.md` (columns: task, date, model, bundle version, dsh version, outcome, notes).

- [ ] **Step 6: Commit.** `git commit -am "feat(zeal): gauntlet runner, overlay, and G1 with first recorded run"`

---

### Task 18: Live smoke test (credential-gated)

**Files:**
- Create: `packages/dsh-zeal/tests/composition/live-smoke.test.ts`

- [ ] **Step 1: Write the test**, `describe.skipIf(!process.env.ZAI_API_KEY || !process.env.ZEAL_COMPOSITION)`: reuse `setupProfile` (Task 16) and the gauntlet overlay (Task 17) — append `gauntlet/overlay.cordis.yml` to the profile's `cordis.patch.yml`; run `env ZEAL_TASK='Run: echo zeal-smoke-$((6*7)) and tell me the exact output' dsh --profile zeal`; assert stdout contains `zeal-smoke-42`.
- [ ] **Step 2: Run with a real key once locally → PASS. Step 3: Commit.** `git commit -am "test(zeal): credential-gated live GLM smoke"`

---

### Task 19: Gauntlet G2–G8

**Files:**
- Create: `gauntlet/tasks/g2-refactor/…` through `gauntlet/tasks/g8-interrupt/…` (same `{task.txt,repo/,verify.sh}` shape; g8 is a documented manual script, no `repo/`)
- Modify: `GAUNTLET.md`

Content per task (each gets its own commit; run each once with a real key and record the row):
- **G2 refactor:** repo with `getUser`/`getUserSync` duplication across 3 files; task: unify into one async API and update all callers; verify: vitest suite that imports the new single export.
- **G3 plan+todo:** task text starts `Plan first, then implement:` a small feature (add a `--json` flag to a CLI in the repo); verify: vitest + `grep -q 'todo_write' "$DSH_HOME"/sessions/*` (todo tool exercised; adjust the glob to the real session-store layout observed in G1's scratch home).
- **G4 subagent:** task: `Use a subagent to audit src/ for TODO comments and then fix each one it reports.`; repo with 3 TODO-marked bugs; verify: vitest + session grep for `"subagent"` tool events.
- **G5 MCP:** repo contains `mcp-server.mjs` — a ~30-line stdio MCP server via `@modelcontextprotocol/sdk` exposing tool `lookup_constant` returning `{"ZEAL_MAGIC": 271828}`; `run.sh` for this task additionally appends the `dsh-mcp-client` row (transport stdio, command `node mcp-server.mjs`) to the profile patch and runs `dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client` first (this task IS the doc-flow rehearsal for spec §4.5); task: `Call the lookup_constant tool from the mcp server and write its value into constant.txt.`; verify: `grep -q 271828 constant.txt`.
- **G6 skill:** repo carries `AGENTS.md` (or the skill layout base's `skill-filesystem` documents — check `$DSH_SRC/packages/skill/skill-filesystem/README.md` and use its real discovery path) mandating: every new function gets a `@zeal-checked` JSDoc tag; task: add a small function; verify: grep for the tag + vitest.
- **G7 compaction:** overlay for this task also retargets `llm-pi-ai` — restating the FULL row config (patch replaces whole config: both routes with their `apiKeyEnv`/`reasoning` values from Task 2, plus route `zai` gaining `models: [{ id: glm-5.2, contextWindow: 16384 }]`, a per-route model reshape — spec A11) so compaction triggers cheaply; repo: 8 files of ~200 lines each; task: summarize every file then fix the one failing test; verify: vitest + session grep for a compaction event type (transcribe the exact event name from `$DSH_SRC/packages/compaction/compaction-basic`).
- **G8 interrupt (manual):** `gauntlet/tasks/g8-interrupt/manual.md` — scripted steps: start `zeal` in a scratch repo, ask for a long task, press Esc mid-turn, verify the status returns to idle and a redirect message steers the next turn; record observations in GAUNTLET.md.

- [ ] Each: build repo + task + verify → run → record → commit (`feat(zeal): gauntlet G<n>`).

---

### Task 20: README and release docs

**Files:**
- Create: `README.md`, `packages/dsh-zeal/README.md`, `packages/zeal/README.md`

Required content (spec §4, V5, V7, N1–N3): quickstart (`npx @zealagent/zeal`, key setup for `ZAI_API_KEY`/`ZHIPU_API_KEY`, `.credentials.yaml` path); manual two-package install line; the MCP flow verbatim (`dsh plugin --profile zeal add @deepseek-ai/dsh-mcp-client` + a stdio and an http row example); the commented self-hosted declared-route template (`baseURL` + `openai-completions` + `thinkingFormat: zai` model list); re-enabling web search with a DeepSeek key (two-line patch); the settings-precedence note (home-level `settings.yaml`, per-route deep-merge, sections can override fields but never remove routes); the `<Static>` no-resize-reflow limitation; macOS/Linux support statement; upgrade ritual (§2.3: bump pins on a branch → `ZEAL_COMPOSITION=1` tests → review snapshot diff → gauntlet → release).

- [ ] Write, spellcheck, commit: `git commit -am "docs(zeal): README, install flows, and operational notes"`

---

## Milestone map (for review pacing)

- **M1 — provider proof:** Tasks 1–3 (with a temporary no-op `src/tui/index.ts` stub so the bundle's `./tui` export builds), 16 (invariants only), 17 (runner + G1), 18. Zeal composes and one real GLM turn works headless.
- **M2 — core TUI:** Tasks 4–10, 14 (partial: no commands), interactive session usable.
- **M3 — full capability:** Tasks 11–15 complete.
- **M4 — quality bar:** Tasks 16 (snapshot), 19, 20.

Executors follow task order as written; the milestone map only tells reviewers what "working" means at each stage.

## Self-review (performed at write time)

- Spec coverage: §2 packages → Tasks 1/15; §3 TUI (driver/answerers/renderer/editor/commands/exit/onboarding) → Tasks 4–14; §4 patch rows + MCP doc-flow → Tasks 2/19-G5/20; §5 error+security → Tasks 5 (notices), 13 (fail-closed mapping), 14 (exit paths), 18 (overlay never shipped: it lives in `gauntlet/`, not in the bundle's patch); §6 five layers → Tasks 5–10 (unit/component), 16 (composition), 18 (smoke), 17+19 (gauntlet); N1 no-dollar rule → Task 9.
- Known deliberate deferrals to execution time (not placeholders): exact `SessionEventMap`/approval-request field names are transcribed in Tasks 4/13 from cited files; `@deepseek-ai/cordis`/`schemastery` publish-form check in Task 1. Each names the file to read and the fallback.
- Type consistency: `ZealEvent`/`TranscriptEntry`/`PendingInteraction`/`QuestionItem`/`ApprovalDecision`/`ZealDriver`/`CommandDispatcher` names match across Tasks 4–14.

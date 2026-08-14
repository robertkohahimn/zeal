# @zealagent/zeal

The Zeal launcher: a small bin that bootstraps a `dsh` `zeal` profile on
first run and then execs into it. This is the package `npx @zealagent/zeal`
runs — see the [root README](../../README.md) for the full user-facing
quickstart, key setup, and configuration flows. This document covers what
the launcher itself does.

Requires Node.js >= 22 (this package's `package.json` `engines` field).

```sh
npx @zealagent/zeal
```

## What the bin does

`src/main.ts` is published as the `zeal` bin (`package.json`'s
`"bin": { "zeal": "./lib/main.js" }`). On every invocation it:

1. Resolves `$DSH_HOME` (the `DSH_HOME` environment variable, or `~/.dsh` if
   unset — `getDshHome()`).
2. Reads `$DSH_HOME/profiles/zeal/package.json`, if it exists, to check
   whether the `zeal` profile already depends on `@zealagent/dsh-zeal`
   (`readProfileManifest` / `planBootstrap`). If the profile doesn't exist
   yet, or exists but lacks that dependency, bootstrap is needed.
3. If bootstrap is needed, spawns:

   ```sh
   dsh plugin --profile zeal add @zealagent/dsh-zeal @deepseek-ai/dsh-code-runtime-worker-thread
   ```

   (`plan.installArgs` in `planBootstrap`) via the `dsh` binary resolved
   from this package's own `@deepseek-ai/dsh` dependency
   (`resolveDshBin()`, which reads that package's `package.json` `bin`
   field rather than assuming a path).
4. Execs the actual app:

   ```sh
   dsh --profile zeal <your original argv>
   ```

   (`plan.launchArgs` — your arguments are passed through verbatim, prefixed
   with `--profile zeal`; both spawns run with `stdio: 'inherit'` so the
   child owns the real terminal directly).

`planBootstrap` and `shouldLaunch` are pure, filesystem-free planning
functions — the launcher reads the profile manifest as data and passes it
in, so bootstrap decisions are unit-testable without touching a real
`$DSH_HOME` (see `tests/bootstrap.test.ts`).

## `DSH_HOME`

Every path this launcher touches is relative to `$DSH_HOME`, which defaults
to `~/.dsh`. Set `DSH_HOME` in your environment to use a different location
— useful for an isolated profile per project, or for tests (the gauntlet
harness does exactly this, pointing `DSH_HOME` at a scratch directory per
run).

## Fail-fast behavior

- If the bootstrap install spawn itself errors (e.g. `dsh` isn't
  resolvable), or exits with a non-zero or `null` status, the launcher never
  proceeds to launch (`shouldLaunch`). It prints
  `zeal: failed to install the zeal dsh profile (<reason>)` to stderr and
  exits with the install's own exit code (or `1` if the spawn itself
  errored, or the status was `null` — e.g. killed by a signal).
- If bootstrap succeeds (or wasn't needed), the launcher execs `dsh
  --profile zeal <args>` and propagates that child process's own exit code
  as its own (`process.exit(child.status ?? 1)`). Zeal's exit code is always
  `dsh`'s exit code — there is no swallowing of a failed run into a `0`.
- The launcher never falls back to reinstalling silently on a later run
  once the profile already has the `@zealagent/dsh-zeal` dependency; the
  bootstrap step is skipped entirely and every subsequent invocation is just
  the exec in step 4.

## Development

```sh
pnpm run build   # tsdown src/main.ts --format esm --out-dir lib
pnpm vitest run  # tests/bootstrap.test.ts
```

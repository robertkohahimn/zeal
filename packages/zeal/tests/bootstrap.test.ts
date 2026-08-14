import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planBootstrap, resolveDshBin, shouldLaunch } from '../src/main.ts'

const INSTALL_ARGS = [
  'plugin',
  '--profile',
  'zeal',
  'add',
  '@zealagent/dsh-zeal',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
]

describe('planBootstrap', () => {
  it('needs init on a fresh home (no profile manifest)', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: undefined,
      argv: [],
    })
    expect(plan.needsInit).toBe(true)
    expect(plan.installArgs).toEqual(INSTALL_ARGS)
  })

  it('needs init when the manifest lacks the zeal dependency', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { 'some-other-plugin': '1.0.0' } },
      argv: [],
    })
    expect(plan.needsInit).toBe(true)
    expect(plan.installArgs).toEqual(INSTALL_ARGS)
  })

  it('does not need init when the manifest already has the zeal dependency', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { '@zealagent/dsh-zeal': '0.1.0' } },
      argv: [],
    })
    expect(plan.needsInit).toBe(false)
  })

  it('passes argv through into launchArgs, prefixed with the zeal profile', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { '@zealagent/dsh-zeal': '0.1.0' } },
      argv: ['--resume', 'session-abc'],
    })
    expect(plan.launchArgs).toEqual(['--profile', 'zeal', '--resume', 'session-abc'])
  })
})

describe('resolveDshBin', () => {
  it('resolves to an existing dsh binary file', () => {
    const bin = resolveDshBin()
    expect(existsSync(bin)).toBe(true)
  })
})

describe('shouldLaunch', () => {
  it('allows launch when the install exited cleanly', () => {
    expect(shouldLaunch({ status: 0 })).toBe(true)
  })

  it('blocks launch when the install exited with a non-zero status', () => {
    expect(shouldLaunch({ status: 1 })).toBe(false)
  })

  it('blocks launch when the install status is null (e.g. killed by signal)', () => {
    expect(shouldLaunch({ status: null })).toBe(false)
  })

  it('blocks launch when the install spawn itself errored', () => {
    expect(shouldLaunch({ status: 0, error: new Error('spawn ENOENT') })).toBe(false)
  })
})

/**
 * Unit coverage for `tui/index.ts`'s pure/testable pieces only —
 * `onboardingNotice` and `defaultLogPath`. `apply()`/`bootZealTui()`
 * themselves need a full fake `ctx` (agents, agentDefaultModel, sessions,
 * userQuestions, commands, sessionQuery, cmdlineArgs, appExit, zealStartup)
 * plus a mounted Ink instance to exercise meaningfully; per this task's
 * brief, that's integration-verified later when Task 16 boots the whole
 * bundle, not unit-tested here.
 * @module @zealagent/dsh-zeal/tests/tui-index
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defaultLogPath, onboardingNotice } from '../src/tui/index.ts'

describe('onboardingNotice', () => {
  it('names ZAI_API_KEY for the zai route', () => {
    const text = onboardingNotice('zai')
    expect(text).toContain('No API key found for the zai route.')
    expect(text).toContain('Set ZAI_API_KEY in your environment')
    expect(text).toContain('$DSH_HOME/.credentials.yaml')
    expect(text).toContain('$DSH_HOME/settings.yaml under llm-pi-ai:')
  })

  it('names ZHIPU_API_KEY for the zai-coding-cn route', () => {
    const text = onboardingNotice('zai-coding-cn')
    expect(text).toContain('No API key found for the zai-coding-cn route.')
    expect(text).toContain('Set ZHIPU_API_KEY in your environment')
  })

  it('falls back gracefully for an unrecognized route rather than naming a wrong env var', () => {
    const text = onboardingNotice('some-future-route')
    expect(text).toContain('No API key found for the some-future-route route.')
    expect(text).not.toContain('ZAI_API_KEY')
    expect(text).not.toContain('ZHIPU_API_KEY')
  })
})

describe('defaultLogPath', () => {
  const originalDshHome = process.env['DSH_HOME']

  afterEach(() => {
    if (originalDshHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = originalDshHome
  })

  it('derives the log path from DSH_HOME when set', () => {
    process.env['DSH_HOME'] = '/tmp/my-dsh-home'
    expect(defaultLogPath()).toBe('/tmp/my-dsh-home/profiles/zeal/logs/zeal.log')
  })

  it('falls back to ~/.dsh when DSH_HOME is unset', () => {
    delete process.env['DSH_HOME']
    const path = defaultLogPath()
    expect(path.endsWith('/.dsh/profiles/zeal/logs/zeal.log')).toBe(true)
  })
})

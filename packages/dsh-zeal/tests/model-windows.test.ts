import { describe, expect, it } from 'vitest'
import { contextWindowFor, DEFAULT_MODEL_WINDOW, MODEL_WINDOWS } from '../src/tui/model-windows.ts'

describe('MODEL_WINDOWS / contextWindowFor (I5, Ruling R4)', () => {
  it('has exactly the documented static entries', () => {
    expect(MODEL_WINDOWS).toEqual({
      'glm-4.5-air': 131072,
      'glm-4.7': 204800,
      'glm-5-turbo': 200000,
      'glm-5.1': 200000,
      'glm-5.2': 1000000,
      'glm-5v-turbo': 200000,
    })
  })

  it('resolves a known model id to its documented window', () => {
    expect(contextWindowFor('glm-5.2')).toBe(1_000_000)
    expect(contextWindowFor('glm-4.5-air')).toBe(131_072)
    expect(contextWindowFor('glm-4.7')).toBe(204_800)
  })

  it('falls back to DEFAULT_MODEL_WINDOW for an unrecognized model id', () => {
    expect(contextWindowFor('some-future-model')).toBe(DEFAULT_MODEL_WINDOW)
    expect(DEFAULT_MODEL_WINDOW).toBe(200_000)
  })
})

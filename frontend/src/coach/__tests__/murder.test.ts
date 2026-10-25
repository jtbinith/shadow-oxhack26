import { describe, expect, it } from 'vitest'
import { CROW_GAP_MS, MAX_CROWS, stepCrows, targetCrows } from '../murder'

describe('murder meter', () => {
  it('no crows while dancing well, then one more at each step towards the threshold', () => {
    expect(targetCrows(0)).toBe(0)
    expect(targetCrows(0.5)).toBe(0)
    expect(targetCrows(0.65)).toBe(1) // just a crow
    expect(targetCrows(0.85)).toBe(2) // an attempted murder
    expect(targetCrows(0.95)).toBe(2)
    expect(targetCrows(1)).toBe(MAX_CROWS) // three at the threshold: a murder, and the flow stops
  })

  it('crows arrive one at a time, even if the dancing falls apart all at once', () => {
    let n = 0
    const seen: number[] = []
    for (let t = 0; t < 4 * CROW_GAP_MS; t += CROW_GAP_MS) {
      n = stepCrows(n, targetCrows(1), CROW_GAP_MS)
      seen.push(n)
    }
    expect(seen).toEqual([1, 2, 3, 3])
  })

  it('no faster than one per gap, and they leave one at a time too', () => {
    expect(stepCrows(1, 3, CROW_GAP_MS / 2)).toBe(1)
    expect(stepCrows(3, 0, CROW_GAP_MS)).toBe(2)
    expect(stepCrows(2, 0, CROW_GAP_MS)).toBe(1)
  })
})

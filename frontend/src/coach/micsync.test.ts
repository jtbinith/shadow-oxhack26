import { describe, expect, it } from 'vitest'
import { countInDelay } from './micsync'

describe('countInDelay', () => {
  it('waits until four beats before the step', () => {
    expect(countInDelay(10, [20], 0.5)).toBeCloseTo(8)
  })
  it('uses a later repeat when the first one is too close', () => {
    expect(countInDelay(17.9, [20, 36], 0.5)).toBeCloseTo(16.1)
  })
  it('gives up when every occurrence has passed', () => {
    expect(countInDelay(40, [20, 36], 0.5)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { layoutBlocks } from '../LessonTree'
import type { Step } from '../../api'

const learn = (i: number): Step => ({ type: 'learn', eight_counts: [i], start_speed: 0.75 })
const chain = (...i: number[]): Step => ({ type: 'chain', eight_counts: i, start_speed: 0.75 })

describe('layoutBlocks', () => {
  it('puts phrases on the bottom row and each checkpoint above what it contains', () => {
    const steps = [learn(0), learn(1), chain(0, 1), learn(2), chain(0, 1, 2)]
    const { blocks, rows } = layoutBlocks(steps, [0, 1, 2])
    const at = (i: number) => blocks.find((b) => b.step === i)!
    expect(rows).toBe(3)
    expect([at(0).row, at(1).row, at(3).row]).toEqual([0, 0, 0])
    expect(at(2)).toMatchObject({ from: 0, to: 1, row: 1 })
    expect(at(4)).toMatchObject({ from: 0, to: 2, row: 2 })
  })
  it('side-by-side checkpoints share a row (a real pyramid)', () => {
    const steps = [learn(0), learn(1), learn(2), learn(3), chain(0, 1), chain(2, 3), chain(0, 1, 2, 3)]
    const { blocks } = layoutBlocks(steps, [0, 1, 2, 3])
    expect(blocks.find((b) => b.step === 4)!.row).toBe(1)
    expect(blocks.find((b) => b.step === 5)!.row).toBe(1)
    expect(blocks.find((b) => b.step === 6)!.row).toBe(2)
  })
})

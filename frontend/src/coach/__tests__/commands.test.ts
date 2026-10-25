import { describe, expect, it } from 'vitest'
import { parseCommand } from '../commands'

const p = (s: string, speed = 1) => parseCommand(s, { speed })?.actions

describe('parseCommand', () => {
  it('acts on speed changes and goes again', () => {
    expect(p('slow it down')).toEqual([{ type: 'speed', speed: 0.75 }, { type: 'redo' }])
    expect(p('can you slow down please', 0.5)).toEqual([{ type: 'speed', speed: 0.25 }, { type: 'redo' }])
    expect(p('half speed')).toEqual([{ type: 'speed', speed: 0.5 }, { type: 'redo' }])
    expect(p('faster', 0.5)).toEqual([{ type: 'speed', speed: 0.75 }, { type: 'redo' }])
  })
  it('understands where: demos, poses and jumps', () => {
    expect(p('show me count three')).toEqual([{ type: 'demo', count: 3 }])
    expect(p('show me eight count 2 count 5')).toEqual([{ type: 'demo', eight_count: 2, count: 5 }])
    expect(p('show me the pose on count 4')).toEqual([{ type: 'show_pose', count: 4 }])
    expect(p('go to eight count three')).toEqual([{ type: 'goto', eight_count: 3 }])
  })
  it('flow controls', () => {
    expect(p('again')).toEqual([{ type: 'redo' }])
    expect(p('skip this')).toEqual([{ type: 'continue' }])
    expect(p('from the top')).toEqual([{ type: 'restart' }])
    expect(p('stop')).toEqual([{ type: 'stop' }])
    expect(p('pause')).toEqual([{ type: 'pause' }])
    expect(p('say that again')).toEqual([{ type: 'repeat_voice' }])
    expect(p("you're too picky, relax")).toEqual([{ type: 'strictness', level: 'relaxed' }])
  })
  it('leaves real questions to the coach', () => {
    expect(p('am I lifting my arm high enough?')).toBeUndefined()
    expect(p('why do I keep missing count 5')).toBeUndefined()
    expect(p("I'm struggling to get the spin")).toBeUndefined()
    expect(p('how does it go on count 3')).toEqual([{ type: 'demo', count: 3 }])
  })
})

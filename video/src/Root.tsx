import React from 'react'
import { AbsoluteFill, Audio, Composition, Sequence, Series, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import durations from './durations.json'
import { Intro, Problem, Upload, Plan, Practice, Murder, Voice, Progress, Tech, Outro } from './scenes'
import { FPS } from './theme'

const SCENES: [keyof typeof durations, React.FC][] = [
  ['intro', Intro], ['problem', Problem], ['upload', Upload], ['plan', Plan], ['practice', Practice],
  ['murder', Murder], ['voice', Voice], ['progress', Progress], ['tech', Tech], ['outro', Outro],
]
const len = (k: keyof typeof durations) => Math.ceil((durations[k] + 0.3 + 0.7) * FPS) // 0.3 s lead-in, 0.7 s breath after

// Each scene fades in and out over 6 frames, with its narration line.
function Scene({ name, C }: { name: string; C: React.FC }) {
  const f = useCurrentFrame()
  const { durationInFrames: d } = useVideoConfig()
  const o = interpolate(f, [0, 6, d - 6, d], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ opacity: o }}><C /></AbsoluteFill>
      <Sequence from={9}><Audio src={staticFile(`vo/${name}.mp3`)} /></Sequence>
    </AbsoluteFill>
  )
}

function Pitch() {
  return (
    <Series>
      {SCENES.map(([k, C]) => (
        <Series.Sequence key={k} durationInFrames={len(k)}><Scene name={k} C={C} /></Series.Sequence>
      ))}
    </Series>
  )
}

export function Root() {
  return <Composition id="Pitch" component={Pitch} durationInFrames={SCENES.reduce((a, [k]) => a + len(k), 0)} fps={FPS} width={1920} height={1080} />
}

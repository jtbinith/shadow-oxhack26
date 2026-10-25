import React from 'react'
import { AbsoluteFill, Audio, Freeze, OffthreadVideo, Sequence, Series, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion'
import durations from './demo_durations.json'
import clipLen from './clip_durations.json'
import tech from './tech_marks.json'
import { Problem, Outro } from './scenes'
import { C, FPS, fontFamily } from './theme'
import { clamp } from './ui'

// The 2-minute demo: real app footage (Playwright recordings + the user's own screencasts of the
// live camera), narrated by the coach's ElevenLabs voice, with the stack as a Mermaid diagram.

type Zoom = { at: number; x: number; y: number; s: number } // seconds into the scene, focus point (px), scale
const LEAD = 8 // narration starts ~0.25 s into each scene

/** A real recording, optionally zooming between focus points; holds its last frame if the line runs longer. */
function Clip({ src, zooms = [], label, sponsor }: { src: keyof typeof clipLen; zooms?: Zoom[]; label: string; sponsor?: string }) {
  const f = useCurrentFrame()
  const last = Math.floor(clipLen[src] * FPS) - 2
  const keys = zooms.length ? zooms : [{ at: 0, x: 960, y: 540, s: 1 }]
  const t = f / FPS
  const pick = (k: 'x' | 'y' | 's') =>
    keys.length === 1 ? keys[0][k] : interpolate(t, keys.map((z) => z.at), keys.map((z) => z[k]), { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const s = pick('s')
  const x = pick('x')
  const y = pick('y')
  const video = <OffthreadVideo src={staticFile(`clips/${src}.mp4`)} muted />
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${960 - x * s}px, ${540 - y * s}px) scale(${s})`, transformOrigin: '0 0' }}>
        {f >= last ? <Freeze frame={last}>{video}</Freeze> : video}
      </AbsoluteFill>
      <Label text={label} sponsor={sponsor} />
    </AbsoluteFill>
  )
}

function Label({ text, sponsor }: { text: string; sponsor?: string }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [4, 12], [0, 1], clamp)
  return (
    <div style={{ position: 'absolute', left: 48, bottom: 44, display: 'flex', gap: 14, opacity: o, transform: `translateY(${(1 - o) * 20}px)`, fontFamily }}>
      <div style={{ background: C.paper, border: `3px solid ${C.ink}`, boxShadow: `6px 6px 0 ${C.edge}`, padding: '8px 22px', fontWeight: 800, fontSize: 40 }}>{text}</div>
      {sponsor && <div style={{ background: C.cta, color: C.paper, border: `3px solid ${C.paper}`, padding: '8px 18px', fontWeight: 700, fontSize: 32, alignSelf: 'center' }}>{sponsor}</div>}
    </div>
  )
}

// Tracking: real footage of a group tracked at once; one small tag for the fingerprint model.
function Tracking() {
  return <Clip src="d_tracking" label="Tracks you in a crowd" sponsor="OSNet re-ID · Hugging Face" />
}

// Under the hood: the four sponsors, each lighting up as it's named.
const SPONSORS: { key: keyof typeof tech; name: string; what: string }[] = [
  { key: 'gemini', name: 'Google Gemini', what: 'plans the lessons and coaches you' },
  { key: 'eleven', name: 'ElevenLabs', what: "the coach's voice, on the beat" },
  { key: 'tiger', name: 'Tiger Data', what: 'every rep stored as time series' },
  { key: 'clerk', name: 'Clerk', what: 'login, your data stays yours' },
]
function Tech() {
  const f = useCurrentFrame()
  const t = (f - LEAD) / FPS
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.paper, fontWeight: 800, fontSize: 72, marginBottom: 56 }}>Built with</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, width: 1500 }}>
        {SPONSORS.map((sp) => {
          const k = interpolate(t, [tech[sp.key] - 0.25, tech[sp.key] + 0.25], [0, 1], clamp)
          return (
            <div key={sp.key} style={{ opacity: 0.25 + 0.75 * k, transform: `scale(${0.96 + 0.04 * k})`, background: k > 0.5 ? C.cta : C.paper, color: k > 0.5 ? C.paper : C.ink, border: `4px solid ${C.paper}`, boxShadow: `10px 10px 0 ${C.edge}`, padding: '34px 40px' }}>
              <div style={{ fontWeight: 800, fontSize: 64, lineHeight: 1 }}>{sp.name}</div>
              <div style={{ fontSize: 36, marginTop: 12 }}>{sp.what}</div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

const SCENES: [keyof typeof durations, React.FC][] = [
  ['intro', () => <Clip src="home" label="Shadow · learn any dance" />],
  ['problem', Problem],
  ['upload', () => <Clip src="d_upload" label="Upload any dance video" zooms={[{ at: 0, x: 620, y: 520, s: 1.25 }, { at: 3, x: 620, y: 520, s: 1.25 }, { at: 5.5, x: 960, y: 540, s: 1 }]} />],
  ['plan', () => <Clip src="plan" label="A lesson plan, built for you" sponsor="Gemini" />],
  ['practice', () => <Clip src="d_practice" label="Dance with a 3D ghost" />],
  ['tracking', Tracking],
  ['crows', () => <Clip src="crows" label="Every slip sends a crow" zooms={[{ at: 0, x: 960, y: 540, s: 1 }, { at: 2.7, x: 960, y: 540, s: 1 }, { at: 3.3, x: 700, y: 330, s: 1.7 }, { at: 7.6, x: 700, y: 330, s: 1.7 }, { at: 8.6, x: 620, y: 700, s: 1.35 }]} />],
  ['carryon', () => <Clip src="d_carryon" label="Match the pose, carry on" />],
  ['voice', () => <Clip src="d_voice" label="Hands-free voice coach" sponsor="ElevenLabs" zooms={[{ at: 0, x: 300, y: 330, s: 2.1 }, { at: 5.2, x: 300, y: 330, s: 2.1 }, { at: 6.2, x: 960, y: 540, s: 1 }]} />],
  ['progress', () => <Clip src="d_progress" label="Progress and habits" sponsor="Tiger Data" />],
  ['tech', Tech],
  ['outro', Outro],
]
const len = (k: keyof typeof durations) => Math.ceil(durations[k] * FPS) + LEAD + 10 // a short breath after each line
export const DEMO_FRAMES = SCENES.reduce((a, [k]) => a + len(k), 0)

function Scene({ name, C: Body }: { name: string; C: React.FC }) {
  const f = useCurrentFrame()
  const { durationInFrames: d } = useVideoConfig()
  const o = interpolate(f, [0, 5, d - 5, d], [0, 1, 1, 0], clamp)
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ opacity: o }}><Body /></AbsoluteFill>
      <Sequence from={LEAD}><Audio src={staticFile(`demo-vo/${name}.mp3`)} /></Sequence>
    </AbsoluteFill>
  )
}

export function Demo() {
  return (
    <Series>
      {SCENES.map(([k, Body]) => (
        <Series.Sequence key={k} durationInFrames={len(k)}><Scene name={k} C={Body} /></Series.Sequence>
      ))}
    </Series>
  )
}

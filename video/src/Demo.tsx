import React from 'react'
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, Series, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion'
import durations from './demo_durations.json'
import clipLen from './clip_durations.json'
import tech from './tech_marks.json'
import trk from './tracking_marks.json'
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

// The stack diagram (Mermaid, rendered to PNG): wipes in, then each part lights up as it's named.
const IMG_W = 1800
const K = IMG_W / 3568 // diagram px -> video px
const TOP = (1080 - 1090 * K) / 2 - 10
const box = (x0: number, y0: number, x1: number, y1: number) => ({ left: 60 + x0 * K, top: TOP + y0 * K, width: (x1 - x0) * K, height: (y1 - y0) * K })
const PARTS: { key: keyof typeof tech; r: ReturnType<typeof box>; until?: keyof typeof tech }[] = [
  { key: 'browser', r: box(12, 246, 2225, 1038), until: 'backend' },
  { key: 'backend', r: box(2624, 12, 3111, 1070), until: 'aist' },
  { key: 'aist', r: box(1868, 21, 2094, 200), until: 'gemini' },
  { key: 'gemini', r: box(3215, 728, 3541, 871), until: 'eleven' },
  { key: 'eleven', r: box(3247, 928, 3509, 1070), until: 'tiger' },
  { key: 'tiger', r: box(3215, 168, 3540, 407), until: 'clerk' },
  { key: 'clerk', r: box(3293, 526, 3461, 669) },
]
function Tech() {
  const f = useCurrentFrame()
  const t = (f - LEAD) / FPS
  const wipe = interpolate(f, [0, 30], [0, 100], { ...clamp, easing: Easing.out(Easing.cubic) })
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily }}>
      <div style={{ position: 'absolute', top: 40, left: 60, color: C.paper, fontWeight: 800, fontSize: 56 }}>Under the hood</div>
      <div style={{ position: 'absolute', left: 60, top: TOP, clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
        <Img src={staticFile('stack.png')} style={{ width: IMG_W }} />
      </div>
      {PARTS.map((p) => {
        const on = t >= tech[p.key] - 0.15 && (!p.until || t < tech[p.until] - 0.15)
        if (!on) return null
        const k = interpolate(t, [tech[p.key] - 0.15, tech[p.key] + 0.2], [0, 1], clamp)
        return <div key={p.key} style={{ position: 'absolute', ...p.r, border: `6px solid ${C.gold}`, boxShadow: `0 0 0 4px rgba(0,0,0,.6), 0 0 40px ${C.gold}`, borderRadius: 10, opacity: k, transform: `scale(${1.06 - 0.06 * k})` }} />
      })}
      <div style={{ position: 'absolute', bottom: 46, left: 60, display: 'flex', gap: 16 }}>
        {['Google Gemini', 'ElevenLabs', 'Tiger Data', 'Clerk'].map((s, i) => {
          const at = [tech.gemini, tech.eleven, tech.tiger, tech.clerk][i]
          const o = interpolate(t, [at - 0.2, at + 0.2], [0, 1], clamp)
          return <div key={s} style={{ opacity: o, background: C.cta, color: C.paper, border: `3px solid ${C.paper}`, padding: '8px 20px', fontWeight: 700, fontSize: 32 }}>{s}</div>
        })}
      </div>
    </AbsoluteFill>
  )
}

// Tracking: real footage of several people tracked at once, with call-outs for the fingerprint.
function Tracking() {
  const f = useCurrentFrame()
  const t = (f - LEAD) / FPS
  const card = (at: number) => interpolate(t, [at - 0.2, at + 0.3], [0, 1], clamp)
  const notes: [number, React.ReactNode, boolean?][] = [
    [trk.fingerprint, <><b>Fingerprint</b> per person</>],
    [trk.osnet, <>OSNet re-ID · <b>512 numbers</b></>, true],
    [trk.colour, <>+ clothing colour + position</>],
    [trk.walk, <>left and came back? <b>same ID</b></>],
  ]
  return (
    <AbsoluteFill>
      <Clip src="d_tracking" label="Tracks you in a crowd" />
      <div style={{ position: 'absolute', right: 48, top: 48, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-end', fontFamily }}>
        {notes.map(([at, txt, hf], i) => (
          <div key={i} style={{ opacity: card(at), transform: `translateX(${(1 - card(at)) * 40}px)`, display: 'flex', gap: 10, alignItems: 'center' }}>
            {hf && <span style={{ background: C.cta, color: C.paper, border: `3px solid ${C.paper}`, padding: '6px 14px', fontWeight: 700, fontSize: 28 }}>Hugging Face</span>}
            <span style={{ background: C.paper, border: `3px solid ${C.ink}`, boxShadow: `6px 6px 0 ${C.edge}`, padding: '8px 18px', fontSize: 32 }}>{txt}</span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

const SCENES: [keyof typeof durations, React.FC][] = [
  ['intro', () => <Clip src="home" label="Shadow · learn any dance" />],
  ['problem', Problem],
  ['upload', () => <Clip src="d_upload" label="Upload any dance video" zooms={[{ at: 0, x: 620, y: 520, s: 1.25 }, { at: 3, x: 620, y: 520, s: 1.25 }, { at: 5.5, x: 960, y: 540, s: 1 }]} />],
  ['plan', () => <Clip src="plan" label="A lesson plan, built for you" sponsor="Gemini" />],
  ['practice', () => <Clip src="d_practice" label="Dance with a 3D ghost" zooms={[{ at: 0, x: 900, y: 330, s: 1.45 }, { at: 4.2, x: 900, y: 330, s: 1.45 }, { at: 4.6, x: 960, y: 540, s: 1 }]} />],
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

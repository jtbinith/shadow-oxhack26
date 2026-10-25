import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import Crow from './Crow'
import HopCrow, { LandingCrow } from './HopCrow'
import { Figure } from './Dancer'
import { C, fontFamily } from './theme'
import { Caption, Pill, Pop, Window, clamp } from './ui'
import marks from './murder_marks.json'

const Page = ({ children }: { children: React.ReactNode }) => (
  <AbsoluteFill style={{ background: C.page, fontFamily, color: C.ink, alignItems: 'center', justifyContent: 'center' }}>{children}</AbsoluteFill>
)
const s2f = (s: number) => Math.round(s * 30) + 9 // narration starts 0.3 s into each scene

function TopBar() {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 100, background: C.chrome, display: 'flex', alignItems: 'center', padding: '0 40px', gap: 18 }}>
      <div style={{ width: 66, height: 66, background: C.ink, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.paper }}>
        <Crow size={48} inverse />
      </div>
      <span style={{ fontWeight: 800, fontSize: 54 }}>Shadow</span>
    </div>
  )
}

function Crows3({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 * scale }}>
      <HopCrow size={130 * scale} delay={0} sway={6} />
      <HopCrow size={165 * scale} delay={-20} sway={-6} />
      <HopCrow size={130 * scale} delay={-40} sway={6} flip />
    </div>
  )
}

// 1 ---------------------------------------------------------------------------------------
export function Intro() {
  return (
    <Page>
      <TopBar />
      <Pop at={4} style={{ marginTop: 80 }}>
        <Window style={{ width: 1640 }} bodyStyle={{ padding: '60px 70px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Pop at={8}><div style={{ fontWeight: 800, fontSize: 124, lineHeight: 1 }}>Hello.</div></Pop>
            <Pop at={18}><div style={{ fontWeight: 800, fontSize: 124, lineHeight: 1.05, whiteSpace: 'nowrap' }}>Learn any dance.</div></Pop>
            <Pop at={34}><div style={{ fontSize: 44, marginTop: 24 }}>From any video, with a coach that watches every rep.</div></Pop>
          </div>
          <Pop at={44}><Crows3 /></Pop>
        </Window>
      </Pop>
    </Page>
  )
}

// 2 ---------------------------------------------------------------------------------------
export function Problem() {
  const words = ['Pause.', 'Rewind.', 'Guess.']
  return (
    <Page>
      <div style={{ display: 'flex', gap: 60 }}>
        {words.map((w, i) => (
          <Pop key={w} at={10 + i * 24}>
            <Window title={['pause', 'rewind', 'guess'][i] + '.exe'} style={{ width: 420 }} bodyStyle={{ textAlign: 'center', padding: 50 }}>
              <div style={{ fontWeight: 800, fontSize: 96 }}>{w}</div>
            </Window>
          </Pop>
        ))}
      </div>
      <Pop at={70} style={{ position: "absolute", bottom: 150, display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ color: C.paper }}><Crow size={100} pose="caw" inverse /></div>
        <div style={{ color: C.paper, fontWeight: 700, fontSize: 56 }}>Nobody tells you what's wrong with your moves.</div>
      </Pop>
    </Page>
  )
}

// 3 ---------------------------------------------------------------------------------------
const MOVES = ['step right', 'arms up', 'body roll', 'kick', 'turn', 'knee up', 'hit', 'hold']
export function Upload() {
  const f = useCurrentFrame()
  const prog = interpolate(f, [40, 100], [0, 1], clamp)
  return (
    <Page>
      <Window title="new-routine.mov" style={{ width: 1600 }} bodyStyle={{ padding: 48 }}>
        <div style={{ fontWeight: 800, fontSize: 56, marginBottom: 24 }}>Learn a new routine</div>
        <div style={{ border: `4px dashed ${C.ink}`, background: C.soft, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, position: 'relative', overflow: 'hidden' }}>
          {f < 30 ? 'Drop a dance video here (up to 10 min)' : (
            <Pop at={30} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <Pill>kuthu-chorus.mp4</Pill>
              <div style={{ width: 600, height: 26, border: `3px solid ${C.ink}`, background: C.paper }}>
                <div style={{ width: `${prog * 100}%`, height: '100%', background: C.ink }} />
              </div>
              <span style={{ fontWeight: 700 }}>{prog < 1 ? 'Finding the beat…' : 'Done'}</span>
            </Pop>
          )}
        </div>
        {/* waveform with beat ticks */}
        <Pop at={100} style={{ marginTop: 34 }}>
          <svg width="1500" height="110">
            {Array.from({ length: 150 }, (_, i) => {
              const h = 14 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.13)) * 70 + (i % 10 === 0 ? 20 : 0)
              return <rect key={i} x={i * 10} y={55 - h / 2} width={6} height={h} fill={i % 10 === 0 ? C.cta : C.edge} />
            })}
          </svg>
        </Pop>
        <div style={{ display: 'flex', gap: 14, marginTop: 24 }}>
          {MOVES.map((m, i) => (
            <Pop key={m} at={135 + i * 8} style={{ flex: 1 }}>
              <div style={{ border: `3px solid ${C.ink}`, background: C.chrome, padding: '10px 6px', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 52, lineHeight: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 24 }}>{m}</div>
              </div>
            </Pop>
          ))}
        </div>
        <Pop at={240} style={{ marginTop: 22 }}>
          <span style={{ background: 'rgba(43,108,255,0.1)', border: `3px solid ${C.cta}`, borderRadius: 14, padding: '8px 18px', fontSize: 30, fontStyle: 'italic' }}>
            No music? The beat comes from the movement.
          </span>
        </Pop>
      </Window>
    </Page>
  )
}

// 4 ---------------------------------------------------------------------------------------
function Medals({ n }: { n: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      {[C.bronze, C.silver, C.gold].map((c, i) => (
        <span key={c} style={{ width: 30, height: 30, borderRadius: 15, border: `3px solid ${C.ink}`, background: i < n ? c : C.paper }} />
      ))}
    </span>
  )
}
export function Plan() {
  const f = useCurrentFrame()
  const cps = ['1–2', '1–3', '1–4', 'Whole routine']
  return (
    <Page>
      <Window title="lesson-plan" style={{ width: 1640 }} bodyStyle={{ padding: 44 }}>
        <div style={{ fontWeight: 800, fontSize: 60 }}>Kuthu Beat Basics</div>
        <div style={{ fontSize: 30, marginBottom: 26 }}><b>123</b> BPM · <b>4</b> eight-counts · <b>1</b> repeat learnt once</div>
        <div style={{ display: 'flex', gap: 26 }}>
          {[0, 1, 2, 3].map((i) => {
            const medals = Math.floor(interpolate(f, [90 + i * 30, 150 + i * 30], [0, 3 - Math.min(i, 2)], clamp))
            return (
              <Pop key={i} at={14 + i * 10} style={{ flex: 1 }}>
                <div style={{ border: `3px solid ${C.ink}`, background: C.paper, boxShadow: `6px 6px 0 ${C.edge}` }}>
                  <div style={{ height: 170, background: '#222', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', overflow: 'hidden' }}>
                    <Figure t={i * 40} width={190} colors={{ torso: '#eee', larm: '#eee', rarm: '#eee', lleg: '#eee', rleg: '#eee' }} />
                  </div>
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 800, fontSize: 34 }}>8-count {i + 1}</div>
                    <div style={{ fontSize: 24, color: '#444' }}>{['step, arms up', 'body roll, kick', 'turn, knee up', 'hit, hold'][i]}</div>
                    <div style={{ marginTop: 10 }}><Medals n={medals} /></div>
                  </div>
                </div>
              </Pop>
            )
          })}
        </div>
        {/* checkpoint bar */}
        <Pop at={70} style={{ marginTop: 40 }}>
          <div style={{ fontWeight: 800, fontSize: 32, marginBottom: 14 }}>Checkpoints</div>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '0 40px' }}>
            <div style={{ position: 'absolute', left: 60, right: 60, top: 22, height: 6, background: C.ink }} />
            {cps.map((c, i) => {
              const done = f > 160 + i * 30
              return (
                <div key={c} style={{ position: 'relative', textAlign: 'center' }}>
                  <div style={{ width: 50, height: 50, borderRadius: 12, border: `4px solid ${C.ink}`, background: done ? C.ink : C.paper, margin: '0 auto', color: C.paper, fontSize: 30, lineHeight: '42px' }}>{i === 3 ? '★' : ''}</div>
                  <div style={{ fontWeight: 700, fontSize: 26, marginTop: 6 }}>{c}</div>
                </div>
              )
            })}
          </div>
        </Pop>
      </Window>
    </Page>
  )
}

// 5 ---------------------------------------------------------------------------------------
function CountStrip({ start = 0 }: { start?: number }) {
  const f = useCurrentFrame()
  const cur = Math.floor(Math.max(0, f - start) / 15) % 8
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ width: 70, height: 70, border: `3px solid ${C.ink}`, background: i === cur ? C.ink : C.chrome, color: i === cur ? C.paper : C.ink, fontWeight: 800, fontSize: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
      ))}
    </div>
  )
}
function Camera({ err = 0, children, colors }: { err?: number; children?: React.ReactNode; colors?: Partial<Record<string, string>> }) {
  const f = useCurrentFrame()
  return (
    <div style={{ width: 760, height: 560, background: '#1a1a1a', border: `3px solid ${C.ink}`, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: 40 }}><Figure ghost width={470} t={f} /></div>
      <div style={{ position: 'absolute', bottom: 40 }}><Figure width={470} t={f - 3} err={err} colors={colors ?? { torso: C.go, larm: C.go, rarm: C.go, lleg: C.go, rleg: C.amber }} /></div>
      <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 10 }}>
        <Pill bg={C.ink} color={C.paper}>YOU</Pill>
      </div>
      {children}
    </div>
  )
}
export function Practice() {
  return (
    <Page>
      <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
        <Pop at={6}>
          <Window title="routine video" bodyStyle={{ padding: 0 }}>
            <div style={{ width: 520, height: 560, background: '#2b2b2b', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <div style={{ marginBottom: 40 }}><Figure width={420} colors={{ torso: '#ddd', larm: '#ddd', rarm: '#ddd', lleg: '#ddd', rleg: '#ddd' }} /></div>
            </div>
          </Window>
        </Pop>
        <Pop at={20}>
          <Window title="your camera" bodyStyle={{ padding: 0 }}>
            <Camera />
          </Window>
        </Pop>
      </div>
      <Pop at={60} style={{ marginTop: 36, display: 'flex', gap: 30, alignItems: 'center' }}>
        <CountStrip start={60} />
        <Pill bg={C.go} color={C.paper} style={{ border: `3px solid ${C.ink}` }}>Flowing · 0.75×</Pill>
      </Pop>
      <Pop at={150} style={{ position: 'absolute', top: 60, display: 'flex', gap: 20 }}>
        {[['matching', C.go], ['close', C.amber], ['off', C.halt]].map(([t, c]) => <Pill key={t} bg={c} color={C.paper} style={{ border: `3px solid ${C.paper}` }}>{t}</Pill>)}
      </Pop>
    </Page>
  )
}

// 6 ---------------------------------------------------------------------------------------
function Bubble({ text, red = false }: { text: string; red?: boolean }) {
  return (
    <div style={{ position: 'relative', background: red ? C.halt : C.paper, color: red ? C.paper : C.ink, fontWeight: 800, fontSize: red ? 44 : 34, padding: '12px 24px', borderRadius: 18, whiteSpace: 'nowrap' }}>
      {text}
      <div style={{ position: 'absolute', left: 30, bottom: -16, width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderTop: `18px solid ${red ? C.halt : C.paper}` }} />
    </div>
  )
}
export function Murder() {
  const f = useCurrentFrame()
  const m = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, s2f(v as number)])) as Record<string, number>
  const stage = f >= m.match ? 'match' : f >= m.fix ? 'fix' : f >= m.crow3 ? 'murder' : f >= m.crow2 ? 2 : f >= m.crow1 ? 1 : 0
  const err = interpolate(f, [m.crow1 - 40, m.crow1, m.match - 10, m.match + 10], [0, 1.2, 1.2, 0], clamp)
  const frozen = stage === 'fix' || stage === 'murder'
  const bubble = stage === 1 ? 'Just a crow…' : stage === 2 ? 'An attempted murder…' : null
  const off = f > m.crow1 - 20 && f < m.match
  return (
    <Page>
      <div style={{ position: 'relative' }}>
        {/* the perch: crows sit above the camera, never on it */}
        <div style={{ height: 190, display: 'flex', alignItems: 'flex-end', gap: 26, paddingLeft: 30, position: 'relative' }}>
          {f >= m.crow1 && <LandingCrow at={m.crow1} />}
          {f >= m.crow2 && <LandingCrow at={m.crow2} />}
          {f >= m.crow3 && <LandingCrow at={m.crow3} flip />}
          <div style={{ position: 'absolute', left: 420, top: 30 }}>
            {bubble && <Bubble text={bubble} />}
            {(stage === 'murder' || stage === 'fix') && <Bubble text="It's a murder!" red />}
          </div>
        </div>
        <div style={{ height: 8, background: C.chrome, width: 760 }} />
        <Window title="your camera" bodyStyle={{ padding: 0 }}>
          <Camera err={frozen ? 1.2 : err} colors={{ torso: C.go, larm: C.go, rarm: off ? C.halt : C.go, lleg: C.go, rleg: C.go }}>
            {(stage === 'fix') && (
              <Pop at={m.fix} style={{ position: 'absolute', right: 20, top: 70 }}>
                <Window title="the fix" style={{ width: 360 }} bodyStyle={{ padding: 20 }}>
                  <div style={{ fontWeight: 800, fontSize: 34, lineHeight: 1.1 }}>Right arm,<br />a touch higher.</div>
                  <div style={{ fontSize: 24, marginTop: 8 }}>Match the ghost to carry on.</div>
                  <div style={{ fontSize: 60, lineHeight: 1, color: C.cta, fontWeight: 800 }}>↑</div>
                </Window>
              </Pop>
            )}
            {stage === 'match' && (
              <Pop at={m.match} style={{ position: 'absolute', top: 70 }}>
                <Pill bg={C.go} color={C.paper} style={{ fontSize: 34, border: `3px solid ${C.paper}` }}>Matched. Carrying on…</Pill>
              </Pop>
            )}
          </Camera>
        </Window>
      </div>
      {f < m.crow1 - 10 && <Caption>Small slips are fine.</Caption>}
    </Page>
  )
}

// 7 ---------------------------------------------------------------------------------------
export function Voice() {
  const f = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const a = Math.round(durationInFrames * 0.22), b = Math.round(durationInFrames * 0.5)
  const speed = f < a + 12 ? '1×' : '0.75×'
  const reply = 'Lift from the shoulder on 3 and keep the elbow soft. Here is the pose.'
  const typed = reply.slice(0, Math.max(0, Math.floor((f - b - 36) * 3)))
  return (
    <Page>
      <div style={{ display: 'flex', gap: 50, alignItems: 'flex-start', transform: 'scale(1.12)' }}>
        <Window title="practice" style={{ width: 640 }} bodyStyle={{ padding: 36, display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 70, height: 70, borderRadius: 35, background: C.halt, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="34" height="40" viewBox="0 0 24 28"><rect x="7" y="1" width="10" height="17" rx="5" fill="#fff" /><path d="M3 13a9 9 0 0 0 18 0M12 22v5" stroke="#fff" strokeWidth="2.5" fill="none" /></svg>
            </div>
            <div style={{ fontWeight: 700, fontSize: 32 }}>Hands-free · listening</div>
          </div>
          <div style={{ fontSize: 30 }}>Speed <Pill style={{ fontSize: 40, marginLeft: 10, background: f > a + 12 && f < a + 40 ? C.cta : C.paper, color: f > a + 12 && f < a + 40 ? C.paper : C.ink }}>{speed}</Pill></div>
          <CountStrip />
        </Window>
        <div style={{ width: 860, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {f > a && <Pop at={a}><div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><div style={{ background: C.paper, borderRadius: 18, padding: '12px 24px', fontSize: 40, fontWeight: 700 }}>“slower”</div><Pill bg={C.go} color={C.paper}>instant · no AI needed</Pill></div></Pop>}
          {f > b && <Pop at={b}><div style={{ background: C.paper, borderRadius: 18, padding: '12px 24px', fontSize: 40, fontWeight: 700, alignSelf: 'flex-start', display: 'inline-block' }}>“how do I fix my arms?”</div></Pop>}
          {f > b + 30 && (
            <Pop at={b + 30}>
              <Window title="coach" bodyStyle={{ padding: 28 }}>
                <div style={{ fontSize: 36, minHeight: 100 }}><b>Coach:</b> {typed}</div>
                {typed.length === reply.length && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 14 }}><Pill bg={C.ink} color={C.paper}>action: show_pose</Pill><Pill>Gemini</Pill><Pill>ElevenLabs voice</Pill></div>
                )}
              </Window>
            </Pop>
          )}
        </div>
      </div>
    </Page>
  )
}

// 8 ---------------------------------------------------------------------------------------
export function Progress() {
  const f = useCurrentFrame()
  const days = Array.from({ length: 30 }, (_, i) => (i % 7 === 2 || i % 5 === 4 ? 0 : 20 + ((i * 37) % 60) + i))
  const habits: [string, number][] = [['Right arm too low (count 3)', 45], ['Late on count 7', 30], ['Left leg not wide enough (count 5)', 15]]
  return (
    <Page>
      <div style={{ width: 1640 }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {[['12', 'day streak'], ['18/24', 'steps passed'], ['640', 'reps'], ['85', 'average score']].map(([n, l], i) => (
            <Pop key={l} at={6 + i * 8} style={{ flex: 1 }}>
              <Window bodyStyle={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 70, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 28 }}>{l}</div>
              </Window>
            </Pop>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 30, marginTop: 34 }}>
          <Pop at={40} style={{ flex: 1 }}>
            <Window title="last-30-days" bodyStyle={{ padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 260 }}>
                {days.map((d, i) => (
                  <div key={i} style={{ flex: 1, background: d ? C.ink : C.chrome, height: `${d ? interpolate(f, [50 + i * 2, 80 + i * 2], [0, d], clamp) : 2}%` }} />
                ))}
              </div>
              <div style={{ fontSize: 24, marginTop: 8 }}>Reps per day</div>
            </Window>
          </Pop>
          <Pop at={90} style={{ flex: 1 }}>
            <Window title="habits" bodyStyle={{ padding: 28 }}>
              <div style={{ fontWeight: 800, fontSize: 36, marginBottom: 14 }}>Habits across your routines</div>
              {habits.map(([h, p], i) => (
                <div key={h} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 28, fontWeight: 600 }}>{h}</div>
                  <div style={{ height: 22, border: `3px solid ${C.ink}` }}><div style={{ height: '100%', background: C.ink, width: `${interpolate(f, [110 + i * 12, 150 + i * 12], [0, p], clamp)}%` }} /></div>
                </div>
              ))}
            </Window>
          </Pop>
        </div>
      </div>
    </Page>
  )
}

// 9 ---------------------------------------------------------------------------------------
function Box({ title, lines, at, hi = false, w = 420 }: { title: string; lines: string[]; at: number; hi?: boolean; w?: number }) {
  return (
    <Pop at={at}>
      <div style={{ width: w, border: `3px solid ${hi ? C.cta : C.ink}`, background: hi ? '#e9f0ff' : C.paper, boxShadow: `8px 8px 0 ${C.edge}`, padding: '18px 22px', transform: hi ? 'scale(1.04)' : 'none' }}>
        <div style={{ fontWeight: 800, fontSize: 34 }}>{title}</div>
        {lines.map((l) => <div key={l} style={{ fontSize: 24 }}>{l}</div>)}
      </div>
    </Pop>
  )
}
export function Tech() {
  const f = useCurrentFrame()
  const { durationInFrames: d } = useVideoConfig()
  const at = (x: number) => Math.round(d * x)
  const on = (x: number, y: number) => f >= at(x) && f < at(y)
  return (
    <Page>
      <div style={{ display: 'flex', gap: 60, alignItems: 'center', transform: 'scale(1.14)' }}>
        <Pop at={4}>
          <div style={{ border: `3px dashed ${C.paper}`, padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ color: C.paper, fontWeight: 800, fontSize: 34 }}>Your browser</div>
            <Box at={10} title="Webcam → pose" lines={['MediaPipe BlazePose + Hands', 'multi-person, re-ID worker']} hi={on(0.05, 0.28)} />
            <Box at={20} title="Mistake detector" lines={['lag-tolerant, every frame', 'drives the crows']} />
            <Box at={30} title="3D ghost + voice" lines={['Three.js · Web Audio']} />
            <Pop at={at(0.12)}><Pill bg={C.go} color={C.paper} style={{ border: `3px solid ${C.paper}` }}>video never leaves your device</Pill></Pop>
          </div>
        </Pop>
        <Pop at={40}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <Box at={40} w={460} title="FastAPI backend" lines={['upload → beats → audio deleted', 'pose → counts → moves', 'learning engine: Elo, spaced review,', 'k-means habits']} />
          </div>
        </Pop>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Box at={at(0.28)} title="Gemini" lines={['plans the course', 'coach agents + actions']} hi={on(0.28, 0.42)} w={400} />
          <Box at={at(0.42)} title="ElevenLabs" lines={['Eleven v4 coach voice', 'count-in on the beat']} hi={on(0.42, 0.58)} w={400} />
          <Box at={at(0.58)} title="Tiger Data" lines={['every rep in a hypertable', 'progress = time_bucket queries']} hi={on(0.58, 0.8)} w={400} />
          <Box at={at(0.8)} title="Clerk" lines={['login, data per user']} hi={f >= at(0.8)} w={400} />
        </div>
      </div>
    </Page>
  )
}

// 10 --------------------------------------------------------------------------------------
export function Outro() {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: f - 4, fps, config: { damping: 12 } })
  return (
    <Page>
      <div style={{ transform: `scale(${0.8 + 0.2 * s})`, opacity: s, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
          <div style={{ width: 170, height: 170, background: C.paper, borderRadius: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Crow size={120} /></div>
          <span style={{ color: C.paper, fontWeight: 800, fontSize: 190 }}>Shadow</span>
        </div>
        <Pop at={30}>
          <div style={{ background: 'rgba(43,108,255,0.18)', border: `3px solid ${C.cta}`, borderRadius: 18, padding: '16px 30px', color: C.paper, fontStyle: 'italic', fontSize: 42, textAlign: 'center' }}>
            You shadow the dancer, move for move.<br />The crows are watching too.
          </div>
        </Pop>
        <Pop at={60}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 26, color: C.paper }}>
            <HopCrow size={110} color={C.paper} sway={6} /><HopCrow size={140} delay={-20} color={C.paper} sway={-6} /><HopCrow size={110} delay={-40} color={C.paper} sway={6} flip />
          </div>
        </Pop>
        <Pop at={80}><div style={{ color: C.chrome, fontSize: 34, fontWeight: 700 }}>Learn any dance. · OxHack '26</div></Pop>
      </div>
    </Page>
  )
}

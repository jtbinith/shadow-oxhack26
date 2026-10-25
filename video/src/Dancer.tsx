import { useCurrentFrame } from 'remotion'
import { C } from './theme'

type P = [number, number]
// A simple dancing figure: arm waves, a knee lift and a sway on an 8-count (one count = 15 frames).
export function pose(t: number, err = 0): Record<string, P> {
  const b = (t / 15) * Math.PI // half a cycle per count
  const sway = Math.sin(b / 2) * 14
  const hip: P = [200 + sway, 230]
  const neck: P = [200 + sway * 0.6, 120]
  const head: P = [neck[0], 78]
  const armL = -0.6 + Math.sin(b) * 1.1
  const armR = 0.6 + Math.sin(b + Math.PI) * 1.1 - err
  const sh = (s: number): P => [neck[0] + s * 34, neck[1] + 6]
  const elbow = (o: P, a: number, s: number): P => [o[0] + s * Math.cos(a) * 52, o[1] - Math.sin(a) * 52 * -1 + 0]
  const lsh = sh(-1), rsh = sh(1)
  const le = elbow(lsh, Math.PI + armL, 1), re = elbow(rsh, -armR, 1)
  const lh: P = [le[0] - Math.cos(armL) * 48, le[1] - Math.sin(armL + 0.4) * 48]
  const rh: P = [re[0] + Math.cos(armR) * 48, re[1] - Math.sin(armR + 0.4) * 48]
  const kneeLift = Math.max(0, Math.sin(b / 2)) * 34
  const lk: P = [hip[0] - 26, 300 - kneeLift], rk: P = [hip[0] + 26, 300]
  const lf: P = [hip[0] - 32, 372 - kneeLift * 1.4], rf: P = [hip[0] + 34, 372]
  return { head, neck, hip, lsh, rsh, le, re, lh, rh, lk, rk, lf, rf }
}
const BONES: [string, string, string][] = [
  ['neck', 'hip', 'torso'], ['lsh', 'rsh', 'torso'], ['lsh', 'le', 'larm'], ['le', 'lh', 'larm'], ['rsh', 're', 'rarm'], ['re', 'rh', 'rarm'],
  ['hip', 'lk', 'lleg'], ['lk', 'lf', 'lleg'], ['hip', 'rk', 'rleg'], ['rk', 'rf', 'rleg'],
]

/** Draws a figure. `colors` per limb (torso/larm/rarm/lleg/rleg); `ghost` = soft grey wide strokes. */
export function Figure({ t, err = 0, colors, ghost = false, width = 400, stroke = 14 }: { t?: number; err?: number; colors?: Partial<Record<string, string>>; ghost?: boolean; width?: number; stroke?: number }) {
  const f = useCurrentFrame()
  const p = pose(t ?? f, err)
  const col = (k: string) => (ghost ? 'rgba(255,255,255,0.35)' : colors?.[k] ?? C.ink)
  return (
    <svg viewBox="0 0 400 400" width={width} height={width} style={{ overflow: 'visible' }}>
      {BONES.map(([a, b, k]) => (
        <line key={a + b} x1={p[a][0]} y1={p[a][1]} x2={p[b][0]} y2={p[b][1]} stroke={col(k)} strokeWidth={ghost ? stroke * 2.2 : stroke} strokeLinecap="round" />
      ))}
      <circle cx={p.head[0]} cy={p.head[1]} r={26} fill={ghost ? 'rgba(255,255,255,0.35)' : colors?.torso ?? C.ink} />
    </svg>
  )
}

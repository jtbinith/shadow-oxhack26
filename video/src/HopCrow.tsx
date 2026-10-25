import { interpolate, useCurrentFrame } from 'remotion'
import Crow from './Crow'
import { C } from './theme'
import { clamp } from './ui'

// One 2 s loop (60 frames at 30 fps), like the app's hopping crow: a big hop, then a smaller one.
function hop(t: number) {
  const ph = ((t % 60) + 60) % 60
  const one = (a: number, len: number, h: number) => {
    const x = (ph - a) / len
    return x >= 0 && x <= 1 ? Math.sin(Math.PI * x) * h : 0
  }
  const y = one(4, 20, 1) + one(34, 14, 0.45)
  const land = Math.max(0, 1 - Math.abs(ph - 25) / 3) + 0.6 * Math.max(0, 1 - Math.abs(ph - 49) / 3)
  return { y, squash: land * 0.12, air: y > 0.08 }
}

/** The hopping crow, frame-driven. `sway` rocks the crow (never its shadow). */
export default function HopCrow({ size = 120, delay = 0, flip = false, sway = 0, color = C.ink, still = false }: { size?: number; delay?: number; flip?: boolean; sway?: number; color?: string; still?: boolean }) {
  const f = useCurrentFrame() + delay
  const { y, squash, air } = still ? { y: 0, squash: 0, air: false } : hop(f)
  const rot = sway * Math.sin((f / 60) * Math.PI * 2)
  return (
    <div style={{ position: 'relative', width: size, height: size * 1.1, color }}>
      <div style={{ position: 'absolute', left: '22%', right: '22%', bottom: -6, height: 8, borderRadius: '50%', background: 'rgba(0,0,0,0.22)', transform: `scaleX(${1 - y * 0.45})` }} />
      <div style={{ position: 'absolute', inset: 0, transformOrigin: '50% 100%', transform: `translateY(${-y * size * 0.45}px) rotate(${rot}deg) scale(${1 + squash}, ${1 - squash})` }}>
        <Crow size={size} pose={air ? 'hop' : 'stand'} flip={flip} inverse={color === C.paper} />
      </div>
    </div>
  )
}

/** A crow flying in from above and landing (frame `at`). */
export function LandingCrow({ at, size = 110, flip = false, color = C.paper }: { at: number; size?: number; flip?: boolean; color?: string }) {
  const f = useCurrentFrame()
  const t = interpolate(f - at, [0, 10], [0, 1], clamp)
  if (f < at) return <div style={{ width: size, height: size * 1.1 }} />
  return (
    <div style={{ transform: `translateY(${(1 - t) * -220}px)`, opacity: t }}>
      <HopCrow size={size} delay={-at - 30} flip={flip} still={t < 1} color={color} />
    </div>
  )
}

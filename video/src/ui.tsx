import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, fontFamily } from './theme'

/** The app's retro window: white body, 2px black outline, grey title bar with two dots, hard grey shadow. */
export function Window({ title, children, style, bodyStyle }: { title?: string; children: React.ReactNode; style?: React.CSSProperties; bodyStyle?: React.CSSProperties }) {
  return (
    <div style={{ background: C.paper, border: `3px solid ${C.ink}`, boxShadow: `10px 10px 0 ${C.edge}`, fontFamily, color: C.ink, display: 'flex', flexDirection: 'column', ...style }}>
      {title !== undefined && (
        <div style={{ background: C.chrome, borderBottom: `3px solid ${C.ink}`, height: 44, display: 'flex', alignItems: 'center', padding: '0 16px', position: 'relative', flexShrink: 0 }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, border: `3px solid ${C.ink}`, marginRight: 8 }} />
          <span style={{ width: 16, height: 16, borderRadius: 8, border: `3px solid ${C.ink}` }} />
          <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontWeight: 700, fontSize: 22 }}>{title}</span>
        </div>
      )}
      <div style={{ padding: 32, flex: 1, position: 'relative', ...bodyStyle }}>{children}</div>
    </div>
  )
}

/** Springs in from below (and fades) starting at frame `at`. */
export function Pop({ at = 0, children, style, from = 40 }: { at?: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 140 } })
  return <div style={{ opacity: interpolate(f - at, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), transform: `translateY(${(1 - s) * from}px)`, ...style }}>{children}</div>
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, textAlign: 'center', fontFamily, fontWeight: 800, fontSize: 54, color: C.paper }}>{children}</div>
}

export function Pill({ children, color = C.ink, bg = C.paper, style }: { children: React.ReactNode; color?: string; bg?: string; style?: React.CSSProperties }) {
  return <span style={{ display: 'inline-block', border: `3px solid ${color}`, color, background: bg, fontFamily, fontWeight: 700, fontSize: 26, padding: '4px 16px', ...style }}>{children}</span>
}

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

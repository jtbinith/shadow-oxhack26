import { AbsoluteFill } from 'remotion'
import Crow from './Crow'
import HopCrow from './HopCrow'
import { C, fontFamily } from './theme'

// Devpost thumbnail (3:2): the logo, the headline and three crows mid-dance.
export function Thumb() {
  return (
    <AbsoluteFill style={{ background: C.page, fontFamily, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.paper, border: `5px solid ${C.ink}`, boxShadow: `16px 16px 0 ${C.edge}`, width: 1280, padding: '60px 70px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ width: 120, height: 120, background: C.ink, borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.paper }}><Crow size={86} inverse /></div>
          <span style={{ fontWeight: 800, fontSize: 130, lineHeight: 1 }}>Shadow</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 92, marginTop: 36, lineHeight: 1 }}>Learn any dance.</div>
        <div style={{ fontSize: 40, marginTop: 18, maxWidth: 720 }}>From any video, with a coach that watches every rep.</div>
        <div style={{ display: 'inline-block', marginTop: 30, background: 'rgba(43,108,255,0.1)', border: `4px solid ${C.cta}`, borderRadius: 18, padding: '12px 22px', fontSize: 32, fontStyle: 'italic' }}>
          Slip up and the crows gather.
        </div>
        <div style={{ position: 'absolute', right: 60, bottom: 50, display: 'flex', alignItems: 'flex-end', gap: 18 }}>
          <HopCrow size={130} delay={10} sway={6} />
          <HopCrow size={170} delay={-5} sway={-6} />
          <HopCrow size={130} delay={-38} sway={6} flip />
        </div>
      </div>
    </AbsoluteFill>
  )
}

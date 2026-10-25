// Dev page (/crow-test.html): watch the murder meter without dancing. Drag "how close to the
// threshold", or press Play to ramp up one crow at a time to a murder, like a rep going wrong.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MurderPerch from '../brand/MurderPerch'
import { stepCrows, targetCrows } from '../coach/murder'

function CrowTest() {
  const [pressure, setPressure] = useState(() => Number(new URLSearchParams(location.search).get('p') ?? 0)) // ?p=0.85 to jump to a level
  const [crows, setCrows] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = useRef({ n: 0, at: 0 })
  // Same update as practice: one crow at a time towards what the pressure calls for.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now()
      const next = stepCrows(last.current.n, targetCrows(pressure), now - last.current.at)
      if (next !== last.current.n) {
        last.current = { n: next, at: now }
        setCrows(next)
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [pressure])
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setPressure((p) => {
      if (p >= 1) { setPlaying(false); return 1 }
      return Math.min(1, Math.round((p + 0.02) * 100) / 100)
    }), 80)
    return () => window.clearInterval(id)
  }, [playing])
  const murder = pressure >= 1 && crows >= 3
  return (
    <section style={{ maxWidth: 900, margin: '2rem auto' }}>
      <h2 style={{ color: '#f2f2f2' }}>Murder meter test</h2>
      <div className="stage-col">
        <MurderPerch count={murder ? 3 : crows} murder={murder} />
        <div className="stage" style={{ width: '100%', aspectRatio: '16 / 9', background: 'repeating-linear-gradient(45deg,#333 0 20px,#3c3c3c 20px 40px)', display: 'grid', placeItems: 'center', color: '#bbb' }}>
          live camera (never covered)
        </div>
      </div>
      <div className="controls" style={{ color: '#f2f2f2' }}>
        <label>How close to the threshold <input type="range" min={0} max={1} step={0.01} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} /> {Math.round(pressure * 100)}%</label>
        <button className="go" onClick={() => { setPressure(0); setPlaying(true) }}>Play: a rep going wrong</button>
        <button onClick={() => { setPlaying(false); setPressure(0); last.current = { n: 0, at: performance.now() }; setCrows(0) }}>Reset</button>
        <span>{crows} crow{crows === 1 ? '' : 's'}</span>
      </div>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(<CrowTest />)

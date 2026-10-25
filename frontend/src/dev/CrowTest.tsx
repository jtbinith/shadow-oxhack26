// Dev page (/crow-test.html): watch the murder meter without dancing. Each mistake sends a crow, at
// most one per cooldown; three is a murder. "Play" makes a mistake every half second, like a rep going wrong.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MurderPerch from '../brand/MurderPerch'
import { CROW_COOLDOWN_MS, NO_CROWS, isMurder, onClean, onMistake } from '../coach/murder'

function CrowTest() {
  const [crows, setCrows] = useState(0)
  const [murder, setMurder] = useState(false)
  const [playing, setPlaying] = useState(false)
  const flock = useRef(NO_CROWS)
  const apply = (mistake: boolean) => {
    if (isMurder(flock.current)) return
    flock.current = mistake ? onMistake(flock.current, performance.now()) : onClean(flock.current, performance.now())
    setCrows(flock.current.n)
    if (isMurder(flock.current)) {
      setMurder(true)
      setPlaying(false)
    }
  }
  // Clean frames tick along, so crows fly off after a clean stretch.
  useEffect(() => {
    const id = window.setInterval(() => !playing && apply(false), 200)
    return () => window.clearInterval(id)
  })
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => apply(true), 500)
    return () => window.clearInterval(id)
  }, [playing])
  const reset = () => {
    setPlaying(false)
    flock.current = NO_CROWS
    setCrows(0)
    setMurder(false)
  }
  return (
    <section style={{ maxWidth: 900, margin: '2rem auto' }}>
      <h2 style={{ color: '#f2f2f2' }}>Murder meter test</h2>
      <div className="stage-col">
        <MurderPerch count={crows} murder={murder} />
        <div className="stage" style={{ width: '100%', aspectRatio: '16 / 9', background: 'repeating-linear-gradient(45deg,#333 0 20px,#3c3c3c 20px 40px)', display: 'grid', placeItems: 'center', color: '#bbb' }}>
          live camera (never covered)
        </div>
      </div>
      <div className="controls" style={{ color: '#f2f2f2' }}>
        <button className="go" onClick={() => apply(true)}>Make a mistake</button>
        <button className="go" onClick={() => { reset(); setPlaying(true) }}>Play: a mistake every 0.5 s</button>
        <button onClick={reset}>Reset</button>
        <span>{crows} crow{crows === 1 ? '' : 's'} · cooldown {CROW_COOLDOWN_MS / 1000} s</span>
      </div>
    </section>
  )
}

createRoot(document.getElementById('root')!).render(<CrowTest />)

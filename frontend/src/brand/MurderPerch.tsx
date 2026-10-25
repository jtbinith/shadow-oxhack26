import { useEffect, useRef, useState } from 'react'
import HoppingCrow from './HoppingCrow'
import { CROW_GAP_MS, MAX_CROWS } from '../coach/murder'

/** The perch above the camera: crows land here one at a time as the dancing nears the threshold.
 * It has a fixed height so nothing jumps, and it sits above the video so the camera is never covered.
 * When the flow stops (`murder`), the remaining crows still land one at a time, CROW_GAP_MS apart,
 * and "It's a murder!" only shows once the third has landed. */
export default function MurderPerch({ count, murder = false, onFull }: { count: number; murder?: boolean; onFull?: () => void }) {
  const [landed, setLanded] = useState(0)
  const n = murder ? Math.max(landed, count) : count
  const lastChange = useRef(0)
  useEffect(() => {
    lastChange.current = performance.now()
  }, [n])
  useEffect(() => {
    if (!murder) {
      setLanded(0)
      return
    }
    if (n >= MAX_CROWS) return
    // The next crow lands CROW_GAP_MS after the last one (straight away if none has landed yet).
    const wait = n === 0 ? 0 : Math.max(0, CROW_GAP_MS - (performance.now() - lastChange.current))
    const id = window.setTimeout(() => setLanded(n + 1), wait)
    return () => window.clearTimeout(id)
  }, [murder, n])
  const full = murder && n >= MAX_CROWS
  useEffect(() => {
    if (full) onFull?.()
  }, [full, onFull])
  return (
    <div className={`murder-perch ${full ? 'murder' : ''} n${n}`} aria-live="polite">
      <span className="perch-crows">
        {Array.from({ length: n }, (_, i) => (
          // The hopping crow (the brand loop), each one out of step with the others.
          <span key={i} className={`perched ${i === 1 ? 'flip' : ''}`}><HoppingCrow size={44} delay={-0.7 * i} inverse /></span>
        ))}
      </span>
      <span className="perch-msg">
        {full ? "It's a murder!" : n === 2 ? 'An attempted murder…' : n === 1 ? 'Just a crow…' : ''}
      </span>
    </div>
  )
}

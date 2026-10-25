import HoppingCrow from './HoppingCrow'

/** The perch above the camera: crows land here one at a time as the dancing nears the threshold.
 * It has a fixed height so nothing jumps, and it sits above the video so the camera is never covered. */
export default function MurderPerch({ count, murder = false }: { count: number; murder?: boolean }) {
  const n = murder ? 3 : count
  return (
    <div className={`murder-perch ${murder ? 'murder' : ''} n${n}`} aria-live="polite">
      <span className="perch-crows">
        {Array.from({ length: n }, (_, i) => (
          // The hopping crow (the brand loop), each one out of step with the others.
          <span key={i} className={`perched ${i === 1 ? 'flip' : ''}`}><HoppingCrow size={44} delay={-0.7 * i} inverse /></span>
        ))}
      </span>
      <span className="perch-msg">
        {murder || n >= 3 ? "It's a murder!" : n === 2 ? 'An attempted murder…' : n === 1 ? 'Just a crow…' : ''}
      </span>
    </div>
  )
}

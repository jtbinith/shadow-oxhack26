import Crow from './Crow'

/** The crow hopping on the spot, looping: crouch, spring up (legs tucked), land with a squash, settle.
 * Two drawings stacked (standing / mid-air) and swapped by the animation. */
export default function HoppingCrow({ size = 64, className = '', paused = false, delay = 0, inverse = false }: { size?: number; className?: string; paused?: boolean; delay?: number; inverse?: boolean }) {
  const style = { animationPlayState: paused ? 'paused' : 'running', animationDelay: `${delay}s` }
  return (
    <span className={`hopping-crow ${className}`} style={{ width: size, height: size * 1.1 }} aria-hidden="true">
      <span className="hop-body" style={style}>
        <span className="hop-frame ground" style={style}><Crow size={size} pose="stand" inverse={inverse} /></span>
        <span className="hop-frame air" style={style}><Crow size={size} pose="hop" inverse={inverse} /></span>
      </span>
      <span className="hop-shadow" style={style} />
    </span>
  )
}

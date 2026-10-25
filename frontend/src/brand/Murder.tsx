import Crow, { type CrowPose } from './Crow'

const POSES: CrowPose[] = ['stand', 'caw', 'peck', 'hop', 'stand', 'caw']

/** A row of crows: a "murder". `count` of them, in mixed poses, some facing the other way. */
export default function Murder({ count = 4, size = 44, className = '' }: { count?: number; size?: number; className?: string }) {
  return (
    <span className={`murder-row ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Crow key={i} pose={POSES[i % POSES.length]} size={size} flip={i % 3 === 1} />
      ))}
    </span>
  )
}

// The Shadow crow: a chunky black silhouette with a big white ring eye (the brand mascot).
// One drawing, a few poses: stand, caw (beak open), flap (a little jump), peck (leaning in), hop. No wings.
export type CrowPose = 'stand' | 'caw' | 'flap' | 'peck' | 'hop'

export default function Crow({ pose = 'stand', size = 48, flip = false, className = '', title, inverse = false }: {
  pose?: CrowPose
  size?: number
  flip?: boolean
  className?: string
  title?: string
  inverse?: boolean // white crow for dark backgrounds, with a solid black eye
}) {
  const tilt = pose === 'peck' ? 22 : pose === 'hop' ? -10 : 0
  return (
    <svg
      viewBox="0 0 100 110" width={size} height={size * 1.1} className={className}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ transform: `${flip ? 'scaleX(-1) ' : ''}${pose === 'flap' ? 'translateY(-8%) ' : ''}rotate(${tilt}deg)` }}
    >
      <g fill="currentColor">
        {/* body + head: a fat teardrop leaning forward, tail feathers at the back */}
        <path d="M34 30 C40 16 60 12 70 22 C76 28 78 38 76 48 C82 62 78 80 64 88 C52 95 34 94 24 86 L10 92 L16 80 L8 78 L20 70 C16 58 20 44 28 36 Z" />
        {/* beak */}
        {pose === 'caw' ? (
          <>
            <path d="M70 26 L96 16 L74 34 Z" />
            <path d="M72 36 L95 40 L72 44 Z" />
          </>
        ) : (
          <path d="M70 26 L98 32 L72 42 Z" />
        )}
        {/* legs */}
        <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none">
          {pose === 'hop' || pose === 'flap' ? (
            <>
              <path d="M42 88 L36 98 L30 100 M36 98 L36 104" />
              <path d="M56 88 L54 99 L48 102 M54 99 L58 104" />
            </>
          ) : (
            <>
              <path d="M42 88 L40 104 M40 104 L32 107 M40 104 L44 108 M40 104 L38 109" />
              <path d="M56 88 L58 104 M58 104 L50 107 M58 104 L63 108 M58 104 L58 109" />
            </>
          )}
        </g>
      </g>
      {/* the eye: a white ring with a dark centre */}
      <circle cx="58" cy="32" r="9.5" fill={inverse ? '#111' : '#fff'} />
      {!inverse && <circle cx="59" cy="32.5" r="6.4" fill="#111" />}
    </svg>
  )
}

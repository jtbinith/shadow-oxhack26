import type { ReactNode } from 'react'

// Navigation links styled like the retro "quick links": a grey outlined tile with the label and
// an arrow. back = arrow first, pointing left; otherwise the arrow points up-right at the end.
export default function QuickLink({ children, onClick, back = false, className = '', title }: {
  children: ReactNode
  onClick: () => void
  back?: boolean
  className?: string
  title?: string
}) {
  const arrow = (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square">
      {back ? <path d="M20 12H5M11 5l-7 7 7 7" /> : <path d="M7 17L17 7M9 7h8v8" />}
    </svg>
  )
  return (
    <button type="button" className={`quicklink ${back ? 'back' : ''} ${className}`} onClick={onClick} title={title}>
      {back && arrow}
      <span>{children}</span>
      {!back && arrow}
    </button>
  )
}

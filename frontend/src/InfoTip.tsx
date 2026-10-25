import type { ReactNode } from 'react'

// A small "i" button: hover, focus or tap it to see an explanation panel.
export default function InfoTip({ children, label = 'What does this mean?' }: { children: ReactNode; label?: string }) {
  return (
    <span className="infotip">
      <button type="button" className="infotip-btn" aria-label={label}>i</button>
      <span className="infotip-panel" role="tooltip">{children}</span>
    </span>
  )
}

/** The medals, explained (used wherever medals appear). */
export function MedalsInfo() {
  return (
    <InfoTip label="What do the medals mean?">
      <b>Medals</b>
      <span className="legend"><span className="tier bronze earned" /> Bronze: passed at 0.5× speed</span>
      <span className="legend"><span className="tier silver earned" /> Silver: passed at 0.75×</span>
      <span className="legend"><span className="tier gold earned" /> Gold: passed at full speed (1×)</span>
      <span className="notice">Pass a step (one clean run, no stops) to unlock the next one.</span>
    </InfoTip>
  )
}

import HoppingCrow from './HoppingCrow'

/** Three crows dancing in the empty space beside the hero headline, out of step with each other. */
export default function DancingCrows() {
  return (
    <span className="dancing-crows" aria-hidden="true">
      <span className="dancer sway-l"><HoppingCrow size={58} delay={0} /></span>
      <span className="dancer sway-r"><HoppingCrow size={74} delay={-0.66} /></span>
      <span className="dancer sway-l flip"><HoppingCrow size={58} delay={-1.33} /></span>
    </span>
  )
}

import HoppingCrow from './HoppingCrow'

/** Three crows dancing in the empty space beside the hero headline, out of step with each other. */
export default function DancingCrows({ scale = 1 }: { scale?: number }) {
  const s = (n: number) => Math.round(n * scale)
  return (
    <span className="dancing-crows" aria-hidden="true">
      <span className="dancer sway-l"><HoppingCrow size={s(98)} delay={0} /></span>
      <span className="dancer sway-r"><HoppingCrow size={s(124)} delay={-0.66} /></span>
      <span className="dancer sway-l flip"><HoppingCrow size={s(98)} delay={-1.33} /></span>
    </span>
  )
}

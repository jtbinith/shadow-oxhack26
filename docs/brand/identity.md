# Shadow: brand identity

## The idea
Shadow's mascot is a crow: a chunky black silhouette with a big white ring eye, no wings.
A group of crows is called a **murder**. That's the hook for the coaching:

- While you dance well, there are no crows.
- As your dancing drifts towards the stop threshold, crows start to gather on the camera, one by one
  (the "murder meter": 1 → 4 crows, with "The crows are gathering…" and "Careful… nearly a murder").
- At the threshold the flow stops: **"It's a murder!"**, then the fix.
- A clean run: **"Not a crow in sight."**

The crows are a friendly warning, never a punishment: playful, a bit cheeky, always followed by
exactly what to fix.

## Assets
- `crow.svg`: the mark (also the favicon, `frontend/public/favicon.svg`).
- `crow-hop.gif`: the hop loop (2 s, 20 fps): a full hop then a smaller one; each crouches, springs with legs tucked, lands with a squash.
- In code: `frontend/src/brand/Crow.tsx` (poses: stand, caw, flap = a little jump, peck, hop),
  `Murder.tsx` (a row of crows), `HoppingCrow.tsx` (the animated loop, used on loading and
  processing screens).

## Look
- Retro, monochrome desktop: white windows with 2px black outlines, a grey title bar with two dots,
  hard offset shadows (grey on the black page), square corners.
- Page: black. Surfaces: white `#fff` and grey `#c9c9c9`. Ink: `#111`.
- Type: **Baloo 2**, extra bold for the wordmark and headlines, regular for text.
- Colour only where it means something:
  - green `#1f9d55` start / play
  - red `#d64545` stop / pause
  - blue `#2b6cff` the main call to action
  - the ghost's limbs: green (matching), amber (close), red (off)
  - medals: bronze, silver, gold

## Voice
Short, warm, specific, a little cheeky ("Callum" hype voice, "Laura" calm voice).
Plain body directions, never degrees or milliseconds: "Right arm, a touch higher. Match the ghost."

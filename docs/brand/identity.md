# Shadow: brand identity

## The idea
Shadow's mascot is a crow: a chunky black silhouette with a big white ring eye, no wings.
A group of crows is called a **murder**. That's the hook for the coaching:

- While you dance well, there are no crows.
- As your dancing drifts towards the stop threshold, crows land one at a time (at least 450 ms apart) on a
  perch **above** the camera, never covering it (the "murder meter", `frontend/src/coach/murder.ts`):
  1. **"Just a crow…"** (60% of the way to the threshold)
  2. **"An attempted murder…"** (80%)
  3. **"It's a murder!"** in a red speech bubble at the threshold. The flow stops and shows the fix.
- The perched crows are the hopping crows. Speech bubbles have no outline and an equilateral tail at 45°.
- A clean run: **"Not a crow in sight."**

The crows are a friendly warning, never a punishment: playful, a bit cheeky, always followed by
exactly what to fix.

## Where the crows appear
- **Logo:** a white crow with a solid black eye in a black rounded square (top bar and favicon).
- **Hero** ("Hello. Learn any dance."): three crows dancing out of step in the empty space, each hopping and
  swaying while its shadow stays flat on the ground. Hidden on narrow screens and with reduced motion.
- **Brand note** under the hero text, in a rounded box with a blue border and a faint blue fill:
  *"You shadow the dancer, move for move. / The crows are watching too: slip up and they gather."*
- **Loading screens:** the hopping-crow GIF in a window ("Waking the crows…").
- **Practice:** the murder meter on the perch above the camera.
- Dev page `/crow-test.html` (`?p=0.85`, slider, Play, Reset) to try the murder meter.

## Assets
- `crow.svg`: the mark (also the favicon, `frontend/public/favicon.svg`).
- `crow-hop.gif`: the hop loop (2 s, 20 fps): a full hop then a smaller one; each crouches, springs with legs tucked, lands with a squash.
- `logo.svg`: the app logo (white crow, black rounded square).
- In code (`frontend/src/brand/`): `Crow.tsx` (poses: stand, caw, flap = a little jump, peck, hop;
  `inverse` = white crow with a solid black eye), `HoppingCrow.tsx` (the animated loop),
  `DancingCrows.tsx` (the three hero crows), `MurderPerch.tsx` (crows and bubble above the camera),
  `Murder.tsx` (a row of crows), `LoadingScreen.tsx` (overlay and small loading windows).

## Look
- Retro, monochrome desktop: white windows with 2px black outlines, a grey title bar with two dots,
  hard offset shadows (grey on the black page), square corners (the brand note and speech bubbles are the rounded exceptions).
- Page: black. Surfaces: white `#fff` and grey `#c9c9c9`. Ink: `#111`.
- Type: **Baloo 2**, extra bold for the wordmark and headlines, regular for text.
- No emojis in the UI.
- Colour only where it means something:
  - green `#1f9d55` start / play
  - red `#d64545` stop / pause
  - blue `#2b6cff` the main call to action (and the brand note's border, with a faint blue fill)
  - the ghost's limbs: green (matching), amber (close), red (off)
  - medals: bronze, silver, gold

## Voice
Short, warm, specific, a little cheeky ("Callum" hype voice, "Laura" calm voice).
Plain body directions, never degrees or milliseconds: "Right arm, a touch higher. Match the ghost."

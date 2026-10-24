# AIST++ calibration of D_EXPERT / D_NOVICE

Attempted calibration of the two scoring constants in `frontend/src/coach/score.ts`
(`D_EXPERT = 0.04`, `D_NOVICE = 0.45`) from the AIST++ 3D keypoint dataset.
**Outcome: the expert and novice-proxy distributions overlap too much (24–29% > the
20% sanity threshold), so the placeholders were kept.** Script:
`backend/scripts/calibrate_aist.py`.

## Method

- Data: `data/aist/keypoints3d/*.pkl` (1,408 files, official AIST++ COCO-17 3D
  keypoints, 60 fps), minus the 45 valid entries in `data/aist/ignore_list.txt`
  (1,363 sequences used).
- **Expert pairs**: same (genre, situation, music, choreography), different dancer —
  two professionals performing the same routine. Sampled round-robin across genres.
- **Novice proxy pairs**: same genre, different choreography — someone dancing the
  wrong moves. Sampled evenly across genres.
- Window: frames 120–360 at 60 fps (seconds 2–6), downsampled to 30 fps to match the
  app (120 frames ≈ 4 s), same offset for every file; clips shorter than 360 frames
  skipped.
- Distance maths replicates `score.ts` exactly: 3D→2D projection onto the frontal
  x–y plane (y flipped so dancers are upright, aspect kept), `normaliseFrame`
  (centre mid-hip, scale by mid-shoulder→mid-hip torso length), `boneDirs` over the
  same 14-bone list (BlazePose indices mapped to COCO-17), `frameCost` with the same
  weights (limbs 1, torso/head 0.2), `dtw` with Sakoe–Chiba band 0.2 and the same
  tie-breaking, mean cost along the best path.

## Distributions (DTW mean cost)

Main run: `--n-pairs 120 --seed 7` → 109 expert, 98 novice-proxy distances (pairs
with too-short clips dropped).

| set                      | n   | min   | p25   | median | p75   | max   |
|--------------------------|-----|-------|-------|--------|-------|-------|
| expert (same choreo)     | 109 | 0.008 | 0.092 | 0.152  | 0.224 | 0.508 |
| novice proxy (wrong choreo) | 98 | 0.056 | 0.177 | 0.241  | 0.318 | 0.656 |

A 60-pair run with seed 42 gave essentially the same numbers (expert median 0.158,
novice p25 0.183), so the result is stable, not a sampling artefact.

## Prescribed constants and why they were rejected

The recipe (D_EXPERT = median expert = **0.152**, D_NOVICE = p25 novice = **0.177**)
fails the sanity check:

- 36.7% of expert distances lie at or above the candidate D_NOVICE, and 21.4% of
  novice distances lie at or below the candidate D_EXPERT (combined overlap ~29%,
  well over the 20% limit).
- The scoring band would be only 0.177 − 0.152 = 0.025 wide: scores would slam from
  100 to 0 over a tiny distance range, far noisier than the pose estimation itself.

**Recommendation: keep the placeholders (0.04 / 0.45).** They bracket the observed
data sensibly — an expert copy (median 0.152) scores ~73 and a wrong-choreography
performance (median 0.241) ~51, with the best expert pairs (≤0.04) at 100 and the
worst wrong-moves pairs (≥0.45) at 0. `score.ts` was left unchanged and all 31
frontend tests pass as-is.

## Caveats

- **No true novices in AIST++**: everyone is a professional, so "wrong
  choreography" is the only available floor — and within a genre the basic (sBM)
  routines share many steps, so some wrong-choreo pairs are nearly identical
  movement (min 0.056). That is the main reason the distributions interleave.
- **Expert pairs exist only in sBM**: advanced (sFM) choreographies are unique per
  dancer in AIST++, so no same-choreo cross-dancer sFM pair exists; the expert set
  is basic-dance only.
- **COCO-17 vs BlazePose-33 mapping**: AIST++ has no BlazePose landmarks; shoulders,
  elbows, wrists, hips, knees, ankles and nose map cleanly, but the head bones use
  nose→shoulder rather than the app's exact landmark positions.
- **3D→2D projection**: world x–y (frontal plane) stands in for the camera view; a
  dancer mid-turn projects differently than on video, inflating distances for
  choreographies with rotation.
- No visibility signal in AIST++ (all joints always present), unlike live webcam
  input where occlusion drops bones from the cost.

Reproduce with:

```
backend/.venv/bin/python -I backend/scripts/calibrate_aist.py --data data/aist --n-pairs 120 --seed 7
```

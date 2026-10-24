import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { PersonTracker } from './tracker'
import { SmootherBank } from './smoothing'
import { clothingHistogram } from './appearance'

export type Landmark = NormalizedLandmark
export type Hand = { side: string; points: Landmark[] }
export type Person = { id: number; body: Landmark[]; hands: Hand[] }
export type Frame = { people: Person[] }

const MAX_PEOPLE = 4
const COLOURS = ['#ffb347', '#ff6fb5', '#9cff6f', '#c58bff']
const L_WRIST = 15
const R_WRIST = 16

// Body points 17–22 are the pose model's rough pinky/index/thumb; the hand model replaces them.
const BODY_HAND_POINTS = { left: [17, 19, 21], right: [18, 20, 22] }

// Join the two models into one skeleton: the hand model's wrist (more precise) becomes the
// body's wrist, and its 21 points replace the pose model's 3 rough hand points.
function fuseHands(person: Person): Person {
  const body = person.body.map((p) => ({ ...p }))
  for (const h of person.hands) {
    const w = h.points[0]
    const dl = Math.hypot(body[L_WRIST].x - w.x, body[L_WRIST].y - w.y)
    const dr = Math.hypot(body[R_WRIST].x - w.x, body[R_WRIST].y - w.y)
    const left = dl <= dr
    body[left ? L_WRIST : R_WRIST] = { ...w, visibility: 1 }
    for (const i of BODY_HAND_POINTS[left ? 'left' : 'right']) body[i] = { ...body[i], visibility: 0 }
  }
  return { ...person, body }
}

// Give each detected hand to the person whose wrist is closest to it.
function torsoLength(b: Landmark[]): number {
  const sx = (b[11].x + b[12].x) / 2
  const sy = (b[11].y + b[12].y) / 2
  const hx = (b[23].x + b[24].x) / 2
  const hy = (b[23].y + b[24].y) / 2
  const shoulders = Math.hypot(b[11].x - b[12].x, b[11].y - b[12].y)
  // When hips are off-screen, shoulder width is a steadier size estimate.
  return Math.max(Math.hypot(sx - hx, sy - hy), shoulders, 0.02)
}

// A hand belongs to a body only if its wrist is within this many torso lengths of that body's wrist.
const HAND_MATCH = 0.6

function assignHands(bodies: Landmark[][], ids: number[], hands: Hand[]): { people: Person[]; loose: Hand[] } {
  const people: Person[] = bodies.map((body, i) => ({ id: ids[i], body, hands: [] }))
  const loose: Hand[] = []
  for (const hand of hands) {
    const w = hand.points[0]
    let best = -1
    let bestScore = Infinity
    bodies.forEach((b, i) => {
      for (const j of [L_WRIST, R_WRIST]) {
        const score = Math.hypot(b[j].x - w.x, b[j].y - w.y) / torsoLength(b)
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      }
    })
    if (best >= 0 && bestScore < HAND_MATCH) people[best].hands.push(hand)
    else loose.push(hand)
  }
  return { people, loose }
}

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'

type Connection = { start: number; end: number }

// Draw only points the model is confident about (or recently was), so nothing jumps around.
function drawSkeleton(ctx: CanvasRenderingContext2D, pts: Landmark[], links: Connection[], colour: string, width: number, radius: number) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const { start, end } of links) {
    const a = pts[start]
    const b = pts[end]
    if (!a || !b || a.visibility === 0 || b.visibility === 0) continue
    ctx.moveTo(a.x * w, a.y * h)
    ctx.lineTo(b.x * w, b.y * h)
  }
  ctx.stroke()
  ctx.fillStyle = '#fff'
  for (const p of pts) {
    if (p.visibility === 0) continue
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, radius, 0, 2 * Math.PI)
    ctx.fill()
  }
}

// Mirrored webcam with every person's body (33 points) and hands (21 points each) drawn on top.
// Only keypoints ever leave this component.
export default function PoseCam({ onFrame }: { onFrame?: (frame: Frame) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Starting camera…')
  const [perf, setPerf] = useState('')

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined
    let hands: HandLandmarker | undefined
    const tracker = new PersonTracker(MAX_PEOPLE)
    // Tuned for dancing: steady when still, follows fast moves with little lag.
    const bodySmooth = new SmootherBank(2.5, 0.6)
    // Fingers move fastest; hand points have no visibility score.
    const handSmooth = new SmootherBank(3.0, 1.0, false)
    // Performance: frame counter, smoothed timings, and the last hand result for skipped frames.
    let frameNo = 0
    let fps = 30
    let lastFrameAt = 0
    let poseMs = 0
    let handMs = 0
    let lastHands: ReturnType<HandLandmarker['detectForVideo']> | null = null
    let lastHists: (Float32Array | null)[] = []
    let lastPerfUpdate = 0
    let lastVideoTime = -1
    // A small copy of each frame for sampling clothing colours (cheap to read).
    const sample = document.createElement('canvas')
    sample.width = 192
    sample.height = 108
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true })!
    let stream: MediaStream | undefined
    let raf = 0
    let cancelled = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        if (cancelled) return
        video.current!.srcObject = stream
        await video.current!.play()
        const fileset = await FilesetResolver.forVisionTasks(WASM)
        ;[landmarker, hands] = await Promise.all([
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: MAX_PEOPLE,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence: 0.4,
            minTrackingConfidence: 0.6,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: MAX_PEOPLE * 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.6,
          }),
        ])
        setStatus('')
        const ctx = canvas.current!.getContext('2d')!
        const loop = () => {
          const v = video.current!
          // Only run the models on a new camera frame; re-running on the same frame adds jitter.
          if (v.readyState >= 2 && landmarker && hands && v.currentTime !== lastVideoTime) {
            lastVideoTime = v.currentTime
            if (canvas.current!.width !== v.videoWidth) {
              canvas.current!.width = v.videoWidth
              canvas.current!.height = v.videoHeight
            }
            const now = performance.now()
            frameNo++
            if (lastFrameAt) fps = 0.9 * fps + 0.1 * (1000 / (now - lastFrameAt))
            lastFrameAt = now
            let t0 = performance.now()
            const body = landmarker.detectForVideo(v, now)
            poseMs = 0.9 * poseMs + 0.1 * (performance.now() - t0)
            // When the frame rate drops, run the hand model every other frame.
            const runHands = fps >= 24 || frameNo % 2 === 0 || !lastHands
            if (runHands) {
              t0 = performance.now()
              lastHands = hands.detectForVideo(v, now)
              handMs = 0.9 * handMs + 0.1 * (performance.now() - t0)
            }
            const hand = lastHands!
            ctx.clearRect(0, 0, v.videoWidth, v.videoHeight)
            // Reading pixels back is slow, so sample clothing colours every 4th frame
            // (and whenever the number of people changes).
            let hists: (Float32Array | null)[]
            if (frameNo % 4 === 0 || lastHists.length !== body.landmarks.length) {
              sampleCtx.drawImage(v, 0, 0, sample.width, sample.height)
              const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height)
              hists = body.landmarks.map((b) => clothingHistogram(pixels, b))
              lastHists = hists
            } else {
              hists = body.landmarks.map(() => null)
            }
            const ids = tracker.update(body.landmarks, hists, now)
            // Drop duplicates / over-limit bodies before giving out hands.
            const keep = ids.map((id, i) => (id >= 0 ? i : -1)).filter((i) => i >= 0)
            const { people: matched, loose } = assignHands(
              keep.map((i) => body.landmarks[i]),
              keep.map((i) => ids[i]),
              hand.landmarks.map((points, i) => ({
                side: hand.handedness[i]?.[0]?.categoryName ?? 'Unknown',
                points,
              })),
            )
            const people = matched.map((person) => ({
              id: person.id,
              body: bodySmooth.smooth(`p${person.id}`, person.body, now),
              hands: person.hands.map((h) => ({ side: h.side, points: handSmooth.smooth(`p${person.id}-${h.side}`, h.points, now) })),
            })).map(fuseHands)
            bodySmooth.prune(now)
            handSmooth.prune(now)
            for (const person of people) {
              const colour = COLOURS[person.id % COLOURS.length]
              drawSkeleton(ctx, person.body, PoseLandmarker.POSE_CONNECTIONS, colour, 4, 3)
              for (const h of person.hands) drawSkeleton(ctx, h.points, HandLandmarker.HAND_CONNECTIONS, colour, 2, 2)
            }
            // Hands whose body wasn't found (e.g. someone at the edge of the frame).
            for (const h of loose) drawSkeleton(ctx, h.points, HandLandmarker.HAND_CONNECTIONS, '#d9d9d9', 1.5, 1.5)
            if (people.length) onFrame?.({ people })
            if (now - lastPerfUpdate > 500) {
              lastPerfUpdate = now
              setPerf(`${fps.toFixed(0)} fps · pose ${poseMs.toFixed(0)} ms · hands ${handMs.toFixed(0)} ms${runHands ? '' : ' (every 2nd frame)'}`)
            }
          }
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch (e) {
        setStatus(`Camera unavailable: ${(e as Error).message}`)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      landmarker?.close()
      hands?.close()
    }
  }, [onFrame])

  return (
    <div className="posecam">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} />
      {status && <p className="notice">{status}</p>}
      {perf && <p className="perf">{perf}</p>}
    </div>
  )
}

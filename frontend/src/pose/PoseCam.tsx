import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { PersonTracker } from './tracker'
import { SmootherBank } from './smoothing'
import { clothingHistogram } from './appearance'

export type Landmark = NormalizedLandmark
export type Hand = { side: string; points: Landmark[] }
// `world` = the same body points in metres (3D), steadier for angle scoring than screen points.
export type Person = { id: number; body: Landmark[]; hands: Hand[]; world?: Landmark[] }
// `dancerId` = the person being coached; everyone else is ignored for scoring.
export type Frame = { people: Person[]; dancerId: number | null }

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
// "fast" (lite) is the default because responsiveness matters most for dance;
// "standard" (full) and "high" (heavy) are more accurate but slower (check the FPS meter).
export type PoseQuality = 'fast' | 'standard' | 'high'
const NEXT_QUALITY: Record<PoseQuality, PoseQuality> = { fast: 'standard', standard: 'high', high: 'fast' }
const POSE_MODELS: Record<PoseQuality, string> = {
  fast: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  standard: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  high: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
}
// How often to refresh each person's OSNet fingerprint.
const REID_EVERY_MS = 300
// If the chosen dancer is gone this long, pick the main person in frame instead.
const DANCER_TIMEOUT_MS = 3000

// Crop a person out of the video at OSNet's input size (128×256), from their visible keypoints.
function cropPerson(v: HTMLVideoElement, body: Landmark[], ctx: CanvasRenderingContext2D): Uint8ClampedArray | null {
  const pts = body.filter((p) => (p.visibility ?? 1) > 0.3)
  if (pts.length < 8) return null
  const vw = v.videoWidth
  const vh = v.videoHeight
  let x0 = Math.min(...pts.map((p) => p.x)) * vw
  let x1 = Math.max(...pts.map((p) => p.x)) * vw
  let y0 = Math.min(...pts.map((p) => p.y)) * vh
  let y1 = Math.max(...pts.map((p) => p.y)) * vh
  // Pad, then widen or heighten to OSNet's 1:2 shape so the person isn't stretched.
  const padX = (x1 - x0) * 0.15
  const padY = (y1 - y0) * 0.1
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY
  const w = x1 - x0
  const h = y1 - y0
  if (h < 60) return null
  // A person mostly cut off by the frame edge gives a misleading fingerprint; skip them.
  const inside = (Math.min(x1, vw) - Math.max(x0, 0)) * (Math.min(y1, vh) - Math.max(y0, 0))
  if (inside < 0.75 * w * h) return null
  if (w * 2 < h) { const extra = (h / 2 - w) / 2; x0 -= extra; x1 += extra }
  else { const extra = (w * 2 - h) / 2; y0 -= extra; y1 += extra }
  ctx.drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, 128, 256)
  return ctx.getImageData(0, 0, 128, 256).data
}
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

// Label above someone's head. The canvas is mirrored on screen, so flip the text back.
function drawLabel(ctx: CanvasRenderingContext2D, body: Landmark[], text: string, colour: string) {
  const nose = body[0]
  if (!nose || nose.visibility === 0) return
  const x = nose.x * ctx.canvas.width
  const y = Math.max(24, nose.y * ctx.canvas.height - 60)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(-1, 1)
  ctx.font = '700 22px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = colour
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

// Mirrored webcam with every person's body (33 points) and hands (21 points each) drawn on top.
// Only keypoints ever leave this component.
export default function PoseCam({ onFrame }: { onFrame?: (frame: Frame) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Starting camera…')
  const [perf, setPerf] = useState('')
  const [quality, setQuality] = useState<PoseQuality>('fast')
  // The person being coached. Kept across model changes; follows their identity, not their position.
  const dancer = useRef<{ id: number | null; lastSeen: number }>({ id: null, lastSeen: 0 })
  // Set by the effect so a click can pick the person under the pointer.
  const pickAt = useRef<((nx: number, ny: number) => void) | null>(null)

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined
    let hands: HandLandmarker | undefined
    const tracker = new PersonTracker(MAX_PEOPLE)
    // A fresh tracker means fresh IDs, so choose the dancer again.
    dancer.current = { id: null, lastSeen: 0 }
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

    // OSNet runs in a background worker; the camera loop never waits for it.
    const reid = new Worker(new URL('./reid.worker.ts', import.meta.url), { type: 'module' })
    let reidReady = false
    let reidBusy = false
    let reidMs = 0
    let lastReidAt = 0
    let reidRequest = 0
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = 128
    cropCanvas.height = 256
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true })!
    reid.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'ready') reidReady = true
      else if (msg.type === 'error') console.warn('re-id model failed to load', msg.message)
      else if (msg.type === 'embeddings') {
        reidBusy = false
        reidMs = 0.8 * reidMs + 0.2 * msg.ms
        const now = performance.now()
        msg.ids.forEach((id: number, k: number) => {
          const change = tracker.addEmbedding(id, msg.embeddings[k], now)
          // A newcomer recognised as someone who left: if they were the dancer, keep them as the dancer.
          if (change?.type === 'merge' && dancer.current.id === change.from) dancer.current.id = change.to
        })
      }
    }

    pickAt.current = (nx, ny) => {
      let best: number | null = null
      let bestDist = Infinity
      for (const p of tracker.people()) {
        const d = Math.hypot(p.cx - nx, p.cy - ny) / p.size
        if (d < bestDist && d < 2.5) {
          bestDist = d
          best = p.id
        }
      }
      if (best !== null) dancer.current = { id: best, lastSeen: performance.now() }
    }

    ;(async () => {
      try {
        // 960×540 is plenty for the models (they work at ~256 px) and much cheaper to process than 720p.
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540, frameRate: 30 }, audio: false })
        if (cancelled) return
        video.current!.srcObject = stream
        await video.current!.play()
        const fileset = await FilesetResolver.forVisionTasks(WASM)
        ;[landmarker, hands] = await Promise.all([
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: POSE_MODELS[quality], delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: MAX_PEOPLE,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence: 0.4,
            minTrackingConfidence: 0.6,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            // Four hands covers the dancer plus one other person; more costs frame rate.
            numHands: 4,
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
            const runHands = fps >= 27 || frameNo % 2 === 0 || !lastHands
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
            const worldById = new Map(keep.map((i) => [ids[i], body.worldLandmarks[i]]))
            const people = matched.map((person) => ({
              id: person.id,
              world: worldById.get(person.id),
              body: bodySmooth.smooth(`p${person.id}`, person.body, now),
              hands: person.hands.map((h) => ({ side: h.side, points: handSmooth.smooth(`p${person.id}-${h.side}`, h.points, now) })),
            })).map(fuseHands)
            bodySmooth.prune(now)
            handSmooth.prune(now)
            // Keep a dancer: the one chosen, or (if they've been gone a while) the biggest person in frame.
            const d = dancer.current
            if (d.id !== null && people.some((p) => p.id === d.id)) d.lastSeen = now
            else if (d.id === null || now - d.lastSeen > DANCER_TIMEOUT_MS) {
              const main = tracker.people().sort((a, b) => b.size - a.size)[0]
              if (main) dancer.current = { id: main.id, lastSeen: now }
            }

            // Refresh fingerprints a few times a second, skipping people who overlap (their crops would mix).
            if (reidReady && !reidBusy && now - lastReidAt > REID_EVERY_MS) {
              const tracked = tracker.people()
              const ids: number[] = []
              const pixels: Uint8ClampedArray[] = []
              for (const person of people) {
                const me = tracked.find((t) => t.id === person.id)
                if (!me) continue
                const overlaps = tracked.some((o) => o.id !== me.id && Math.hypot(o.cx - me.cx, o.cy - me.cy) / ((o.size + me.size) / 2) < 1.2)
                if (overlaps) continue
                const crop = cropPerson(v, person.body, cropCtx)
                if (crop) {
                  ids.push(person.id)
                  pixels.push(crop)
                }
              }
              if (ids.length) {
                reidBusy = true
                lastReidAt = now
                reid.postMessage({ type: 'embed', requestId: ++reidRequest, ids, pixels })
              }
            }

            for (const person of people) {
              const colour = COLOURS[person.id % COLOURS.length]
              const isDancer = person.id === dancer.current.id
              drawSkeleton(ctx, person.body, PoseLandmarker.POSE_CONNECTIONS, colour, isDancer ? 6 : 3, isDancer ? 3.5 : 2.5)
              for (const h of person.hands) drawSkeleton(ctx, h.points, HandLandmarker.HAND_CONNECTIONS, colour, 2, 2)
              if (isDancer) drawLabel(ctx, person.body, 'YOU', colour)
            }
            // Hands whose body wasn't found (e.g. someone at the edge of the frame).
            for (const h of loose) drawSkeleton(ctx, h.points, HandLandmarker.HAND_CONNECTIONS, '#d9d9d9', 1.5, 1.5)
            if (people.length) onFrame?.({ people, dancerId: dancer.current.id })
            if (now - lastPerfUpdate > 500) {
              lastPerfUpdate = now
              setPerf(`${fps.toFixed(0)} fps · pose (${quality}) ${poseMs.toFixed(0)} ms · hands ${handMs.toFixed(0)} ms${runHands ? '' : ' (every 2nd frame)'} · re-id ${reidReady ? `${reidMs.toFixed(0)} ms` : 'loading'}`)
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
      reid.terminate()
      pickAt.current = null
    }
  }, [onFrame, quality])

  // The video is mirrored on screen, so flip the click's x back to camera coordinates.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    pickAt.current?.(1 - (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  return (
    <div className="posecam" onClick={onClick} title="Click a person to coach them">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} />
      {status && <p className="notice">{status}</p>}
      {perf && <p className="perf">{perf}</p>}
      <button
        className="quality"
        onClick={(e) => {
          e.stopPropagation()
          setQuality((q) => NEXT_QUALITY[q])
        }}
      >
        Accuracy: {quality}
      </button>
    </div>
  )
}

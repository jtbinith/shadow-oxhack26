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

// Give each detected hand to the person whose wrist is closest to it.
function assignHands(bodies: Landmark[][], ids: number[], hands: Hand[]): Person[] {
  const people: Person[] = bodies.map((body, i) => ({ id: ids[i], body, hands: [] }))
  for (const hand of hands) {
    const w = hand.points[0]
    let best = -1
    let bestDist = Infinity
    bodies.forEach((b, i) => {
      for (const j of [L_WRIST, R_WRIST]) {
        const d = Math.hypot(b[j].x - w.x, b[j].y - w.y)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
    })
    if (best >= 0 && bestDist < 0.15) people[best].hands.push(hand)
  }
  return people
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

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined
    let hands: HandLandmarker | undefined
    const tracker = new PersonTracker(MAX_PEOPLE)
    const bodySmooth = new SmootherBank(1.2, 0.05)
    // Fingers move fast; a higher beta keeps them responsive.
    const handSmooth = new SmootherBank(1.5, 0.15)
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
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
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
            const body = landmarker.detectForVideo(v, now)
            const hand = hands.detectForVideo(v, now)
            ctx.clearRect(0, 0, v.videoWidth, v.videoHeight)
            sampleCtx.drawImage(v, 0, 0, sample.width, sample.height)
            const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height)
            const hists = body.landmarks.map((b) => clothingHistogram(pixels, b))
            const ids = tracker.update(body.landmarks, hists, now)
            const people = assignHands(
              body.landmarks,
              ids,
              hand.landmarks.map((points, i) => ({
                side: hand.handedness[i]?.[0]?.categoryName ?? 'Unknown',
                points,
              })),
            ).map((person) => ({
              id: person.id,
              body: bodySmooth.smooth(`p${person.id}`, person.body, now),
              hands: person.hands.map((h) => ({ side: h.side, points: handSmooth.smooth(`p${person.id}-${h.side}`, h.points, now) })),
            }))
            bodySmooth.prune(now)
            handSmooth.prune(now)
            for (const person of people) {
              const colour = COLOURS[person.id % COLOURS.length]
              drawSkeleton(ctx, person.body, PoseLandmarker.POSE_CONNECTIONS, colour, 4, 3)
              for (const h of person.hands) drawSkeleton(ctx, h.points, HandLandmarker.HAND_CONNECTIONS, colour, 2, 2)
            }
            if (people.length) onFrame?.({ people })
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
    </div>
  )
}

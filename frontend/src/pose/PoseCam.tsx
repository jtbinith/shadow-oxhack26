import { useEffect, useRef, useState } from 'react'
import { DrawingUtils, FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'

export type Landmark = { x: number; y: number; z: number }
export type Frame = { body: Landmark[]; hands: { side: string; points: Landmark[] }[] }

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'

// Mirrored webcam with the live body (33 points) and hands (21 points each) drawn on top.
// Only keypoints ever leave this component.
export default function PoseCam({ onFrame }: { onFrame?: (frame: Frame) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Starting camera…')

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined
    let hands: HandLandmarker | undefined
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
            numPoses: 1,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          }),
        ])
        setStatus('')
        const ctx = canvas.current!.getContext('2d')!
        const draw = new DrawingUtils(ctx)
        const loop = () => {
          const v = video.current!
          if (v.readyState >= 2 && landmarker && hands) {
            canvas.current!.width = v.videoWidth
            canvas.current!.height = v.videoHeight
            const now = performance.now()
            const body = landmarker.detectForVideo(v, now)
            const hand = hands.detectForVideo(v, now)
            ctx.clearRect(0, 0, v.videoWidth, v.videoHeight)
            for (const lm of body.landmarks) {
              draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#ffb347', lineWidth: 4 })
              draw.drawLandmarks(lm, { color: '#fff', radius: 3 })
            }
            for (const lm of hand.landmarks) {
              draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: '#7fd8ff', lineWidth: 2 })
              draw.drawLandmarks(lm, { color: '#fff', radius: 2 })
            }
            if (body.landmarks[0]) {
              onFrame?.({
                body: body.landmarks[0],
                hands: hand.landmarks.map((points, i) => ({
                  side: hand.handedness[i]?.[0]?.categoryName ?? 'Unknown',
                  points,
                })),
              })
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
    </div>
  )
}

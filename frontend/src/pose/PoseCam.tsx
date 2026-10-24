import { useEffect, useRef, useState } from 'react'
import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'

// Mirrored webcam with the live skeleton drawn on top. Only keypoints ever leave this component.
export default function PoseCam({ onPose }: { onPose?: (landmarks: { x: number; y: number; z: number }[]) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Starting camera…')

  useEffect(() => {
    let landmarker: PoseLandmarker | undefined
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
        landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        setStatus('')
        const ctx = canvas.current!.getContext('2d')!
        const draw = new DrawingUtils(ctx)
        const loop = () => {
          const v = video.current!
          if (v.readyState >= 2 && landmarker) {
            canvas.current!.width = v.videoWidth
            canvas.current!.height = v.videoHeight
            const result = landmarker.detectForVideo(v, performance.now())
            ctx.clearRect(0, 0, v.videoWidth, v.videoHeight)
            for (const lm of result.landmarks) {
              draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#ffb347', lineWidth: 4 })
              draw.drawLandmarks(lm, { color: '#fff', radius: 3 })
              onPose?.(lm)
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
    }
  }, [onPose])

  return (
    <div className="posecam">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} />
      {status && <p className="notice">{status}</p>}
    </div>
  )
}

/// <reference lib="webworker" />
// Runs the OSNet re-identification model off the main thread, so the camera loop never waits.
// In: person crops (128×256 RGBA). Out: one 512-number "who is this" fingerprint per crop.
import * as ort from 'onnxruntime-web/wasm'

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'
// No cross-origin isolation on this page, so ONNX Runtime can't use threads.
ort.env.wasm.numThreads = 1

const W = 128
const H = 256
// ImageNet normalisation, which OSNet was trained with.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let session: ort.InferenceSession | null = null
const ready = ort.InferenceSession.create('/models/osnet_x0_25_msmt17.onnx', { executionProviders: ['wasm'] }).then(
  (s) => {
    session = s
    postMessage({ type: 'ready' })
  },
  (e) => postMessage({ type: 'error', message: String(e) }),
)

type Request = { type: 'embed'; requestId: number; ids: number[]; pixels: Uint8ClampedArray[] }

onmessage = async (e: MessageEvent<Request>) => {
  await ready
  if (!session) return
  const { requestId, ids, pixels } = e.data
  const n = pixels.length
  const input = new Float32Array(n * 3 * H * W)
  pixels.forEach((rgba, k) => {
    const base = k * 3 * H * W
    for (let i = 0; i < H * W; i++) {
      for (let c = 0; c < 3; c++) input[base + c * H * W + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c]
    }
  })
  const t0 = performance.now()
  const out = await session.run({ input: new ort.Tensor('float32', input, [n, 3, H, W]) })
  const raw = out[session.outputNames[0]].data as Float32Array
  const embeddings: Float32Array[] = []
  for (let k = 0; k < n; k++) {
    const v = raw.slice(k * 512, (k + 1) * 512)
    // Unit length, so similarity is a plain dot product (cosine similarity).
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < v.length; i++) v[i] /= norm
    embeddings.push(v)
  }
  postMessage({ type: 'embeddings', requestId, ids, embeddings, ms: performance.now() - t0 })
}

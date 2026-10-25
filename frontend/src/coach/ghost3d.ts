// The 3D ghost: a lit, shaded mannequin of the routine's pose, drawn over the camera.
//
// x/y come from the same 2D reference points as the flat ghost (so it sits exactly where that
// one did, on the learner); depth comes from MediaPipe's 3D "world" landmarks for the same
// frame, scaled to the same torso size. An orthographic camera in canvas pixels keeps the
// projection identical to the 2D overlay — the 3D adds shading, thickness and limbs passing
// in front of / behind the body.
import * as THREE from 'three'
import { BONES, type Frame } from './score'

type At = { x: number; y: number; torso: number }

const UP = new THREE.Vector3(0, 1, 0)
// Joints that get a ball, with their radius as a fraction of torso length.
const JOINTS: [number, number][] = [[11, 0.11], [12, 0.11], [13, 0.085], [14, 0.085], [15, 0.075], [16, 0.075], [23, 0.12], [24, 0.12], [25, 0.1], [26, 0.1], [27, 0.08], [28, 0.08]]
// Limb segment radii (upper / lower), matching the flat ghost's thickness.
const LIMB_R = [0.11, 0.08, 0.11, 0.08, 0.13, 0.095, 0.13, 0.095]
const BODY = new THREE.Color(127 / 255, 216 / 255, 1)

function parseRgba(s: string | null): { color: THREE.Color; opacity: number } | null {
  const m = s?.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  if (!m) return null
  return { color: new THREE.Color(+m[1] / 255, +m[2] / 255, +m[3] / 255), opacity: m[4] === undefined ? 1 : +m[4] }
}

function material(color: THREE.Color, opacity: number) {
  return new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.4), roughness: 0.45, metalness: 0.05, transparent: true, opacity })
}

export class Ghost3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10000, 10000)
  private limbs: THREE.Mesh[] = []
  private limbMats: THREE.MeshStandardMaterial[] = []
  private joints: THREE.Mesh[] = []
  private torso: THREE.Mesh
  private neck: THREE.Mesh
  private head: THREE.Mesh
  private feet: THREE.Mesh[] = []
  private bodyMat = material(BODY, 0.62)
  private size = { w: 0, h: 0 }
  private tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Matrix4() }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false })
    this.renderer.setClearColor(0x000000, 0)
    this.camera.position.set(0, 0, 5000)
    this.camera.lookAt(0, 0, 0)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(-0.4, 1, 0.8)
    this.scene.add(key)

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
    const ball = new THREE.SphereGeometry(1, 20, 14)
    for (let i = 0; i < 8; i++) {
      const m = material(BODY, 0.6)
      this.limbMats.push(m)
      const mesh = new THREE.Mesh(cyl, m)
      this.limbs.push(mesh)
      this.scene.add(mesh)
    }
    for (let k = 0; k < JOINTS.length; k++) {
      // Each ball shares the material of the limb it starts (shoulder → upper arm, etc.).
      const mesh = new THREE.Mesh(ball, this.bodyMat)
      this.joints.push(mesh)
      this.scene.add(mesh)
    }
    // Torso: wider at the shoulders than the hips, flattened front-to-back.
    this.torso = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 1, 28), this.bodyMat)
    this.neck = new THREE.Mesh(cyl, this.bodyMat)
    this.head = new THREE.Mesh(ball, this.bodyMat)
    for (let k = 0; k < 2; k++) {
      const f = new THREE.Mesh(cyl, this.bodyMat)
      this.feet.push(f)
      this.scene.add(f)
    }
    this.scene.add(this.torso, this.neck, this.head)
  }

  private resize(w: number, h: number) {
    if (w === this.size.w && h === this.size.h) return
    this.size = { w, h }
    this.renderer.setSize(w, h, false)
    this.camera.left = 0
    this.camera.right = w
    this.camera.top = 0
    this.camera.bottom = -h
    this.camera.updateProjectionMatrix()
  }

  /** Point i in scene space, or null if it isn't visible in the reference. */
  private point(f: Frame, world: number[][] | null, i: number, at: At, zScale: number, zHip: number, out: THREE.Vector3) {
    const p = f[i]
    if (!p) return null
    const z = world && world[i] ? -(world[i][2] - zHip) * zScale : 0 // MediaPipe: smaller z = nearer the camera
    return out.set(at.x + p[0] * at.torso, -(at.y + p[1] * at.torso), z)
  }

  /** Stretch a unit cylinder between a and b with the given radius. */
  private segment(mesh: THREE.Mesh, a: THREE.Vector3 | null, b: THREE.Vector3 | null, r: number) {
    if (!a || !b) {
      mesh.visible = false
      return
    }
    const d = this.tmp.d.subVectors(b, a)
    const len = d.length()
    if (len < 1e-3) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    mesh.position.addVectors(a, b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len))
    mesh.scale.set(r, len, r)
  }

  render(f: Frame, world: number[][] | null, at: At, colours: (string | null)[], w: number, h: number) {
    this.resize(w, h)
    // Depth scale: the reference's 3D torso length maps onto the same pixels as its 2D torso.
    let zScale = 0
    let zHip = 0
    const W = world && world.length === 33 && world.some((q) => q[0] || q[1] || q[2]) ? world : null
    if (W) {
      const mid = (a: number, b: number) => [(W[a][0] + W[b][0]) / 2, (W[a][1] + W[b][1]) / 2, (W[a][2] + W[b][2]) / 2]
      const sh = mid(11, 12)
      const hip = mid(23, 24)
      const len = Math.hypot(sh[0] - hip[0], sh[1] - hip[1], sh[2] - hip[2])
      zScale = len > 0.05 ? at.torso / len : 0
      zHip = hip[2]
    }
    const pts = new Map<number, THREE.Vector3>()
    const P = (i: number) => {
      if (!pts.has(i)) {
        const v = this.point(f, W, i, at, zScale, zHip, new THREE.Vector3())
        if (v) pts.set(i, v)
      }
      return pts.get(i) ?? null
    }

    // Limbs, coloured by how close the learner is.
    BONES.slice(0, 8).forEach(([a, b], i) => {
      const c = parseRgba(colours[i])
      if (c) {
        this.limbMats[i].color.copy(c.color)
        this.limbMats[i].emissive.copy(c.color).multiplyScalar(0.4)
        this.limbMats[i].opacity = Math.min(0.85, c.opacity + 0.1)
      }
      this.segment(this.limbs[i], c ? P(a) : null, c ? P(b) : null, LIMB_R[i] * at.torso)
    })
    // Joint balls take the colour of the limb leaving them.
    const limbOf: Record<number, number> = { 11: 0, 13: 1, 15: 1, 12: 2, 14: 3, 16: 3, 23: 4, 25: 5, 27: 5, 24: 6, 26: 7, 28: 7 }
    JOINTS.forEach(([j, r], k) => {
      const p = P(j)
      const mesh = this.joints[k]
      mesh.visible = !!p && this.limbs[limbOf[j]].visible
      if (!p) return
      mesh.material = this.limbMats[limbOf[j]]
      mesh.position.copy(p)
      mesh.scale.setScalar(r * at.torso)
    })
    // Feet: ankle to toe.
    this.segment(this.feet[0], P(27), P(31), 0.05 * at.torso)
    this.segment(this.feet[1], P(28), P(32), 0.05 * at.torso)

    // Torso, oriented by the shoulder and hip lines.
    const ls = P(11), rs = P(12), lh = P(23), rh = P(24)
    if (ls && rs && lh && rh) {
      const shMid = this.tmp.a.addVectors(ls, rs).multiplyScalar(0.5)
      const hipMid = this.tmp.b.addVectors(lh, rh).multiplyScalar(0.5)
      const up = new THREE.Vector3().subVectors(shMid, hipMid)
      const height = up.length()
      up.normalize()
      const across = new THREE.Vector3().subVectors(ls, rs)
      const width = Math.max(across.length(), new THREE.Vector3().subVectors(lh, rh).length(), 0.3 * at.torso) * 1.15
      across.addScaledVector(up, -across.dot(up)).normalize()
      const fwd = new THREE.Vector3().crossVectors(across, up)
      this.tmp.m.makeBasis(across, up, fwd)
      this.torso.visible = true
      this.torso.quaternion.setFromRotationMatrix(this.tmp.m)
      this.torso.position.addVectors(shMid, hipMid).multiplyScalar(0.5)
      this.torso.scale.set(width, height * 1.08, width * 0.5)
      // Neck and head.
      const nose = P(0)
      if (nose) {
        const r = Math.max(8, nose.distanceTo(shMid) * 0.55)
        const headC = nose.clone().addScaledVector(up, -r * 0.35)
        this.head.visible = true
        this.head.position.copy(headC)
        this.head.scale.set(r * 0.85, r, r * 0.9)
        this.segment(this.neck, shMid.clone(), headC, 0.07 * at.torso)
      } else {
        this.head.visible = false
        this.neck.visible = false
      }
    } else {
      this.torso.visible = this.head.visible = this.neck.visible = false
    }
    this.renderer.render(this.scene, this.camera)
  }

  clear() {
    this.renderer.clear()
  }

  dispose() {
    this.renderer.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }
}

// The coach's voice: ElevenLabs audio (cached twice — server-side per line, and as object
// URLs here), falling back to the browser's built-in speech when it's unavailable.
const clipCache = new Map<string, string>()
// When the coach last made a sound. Speech-to-text delivers words up to ~1 s after the audio
// stops, so listening has to keep ignoring the mic for a moment after the coach finishes.
let lastSoundAt = 0
const ECHO_MS = 1500
// One voice channel for the whole app: whatever speaks next stops what's speaking now.
let playing: HTMLAudioElement | null = null
let generation = 0

/** Is anything being said right now (coach audio or the browser voice)? */
export function isSpeaking(): boolean {
  return (!!playing && !playing.paused && !playing.ended) || !!window.speechSynthesis?.speaking
}

/** Stop whatever is being said (and anything queued after it). */
export function stopVoice() {
  generation++
  playing?.pause()
  window.speechSynthesis?.cancel()
}

export function speakFallback(text: string, rate = 1.05) {
  if (!('speechSynthesis' in window)) return
  stopVoice()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  lastSoundAt = performance.now()
  u.onend = () => { lastSoundAt = performance.now() }
  window.speechSynthesis.speak(u)
}

/** Split into sentence-sized lines the voice API accepts (it caps a line at 200 characters). */
export function chunks(text: string, max = 190): string[] {
  const out: string[] = []
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    let s = sentence.trim()
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', max)
      out.push(s.slice(0, cut > 40 ? cut : max))
      s = s.slice(cut > 40 ? cut + 1 : max).trim()
    }
    if (!s) continue
    // Join short sentences so there are fewer gaps between clips.
    if (out.length && out[out.length - 1].length + s.length + 1 <= max) out[out.length - 1] += ' ' + s
    else out.push(s)
  }
  return out
}

/** The coach's voice. speak() plays (stopping anything already playing) and resolves when done;
 * prefetch() fetches a line's audio ahead of time so it plays instantly later. */
export function makeSpeak(getToken: () => Promise<string | null>, persona: () => string) {
  const pending = new Map<string, Promise<string>>()

  const clip = (line: string): Promise<string> => {
    const key = `${persona()}|${line}`
    const cached = clipCache.get(key)
    if (cached) return Promise.resolve(cached)
    let p = pending.get(key)
    if (!p) {
      p = (async () => {
        const token = await getToken()
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: line, persona: persona() }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const url = URL.createObjectURL(await res.blob())
        clipCache.set(key, url)
        return url
      })().finally(() => pending.delete(key))
      pending.set(key, p)
    }
    return p
  }

  const speak = async (text: string, rate = 1.05) => {
    stopVoice()
    const mine = generation
    const lines = chunks(text)
    const urls = lines.map((l) => clip(l).catch(() => null)) // fetch all lines at once
    for (let i = 0; i < lines.length; i++) {
      const url = await urls[i]
      if (mine !== generation) return // something newer is being said
      if (!url) {
        speakFallback(lines.slice(i).join(' '), rate)
        return
      }
      if (mine !== generation) return
      const a = new Audio(url)
      playing = a
      await new Promise<void>((done) => {
        a.onended = () => { lastSoundAt = performance.now(); done() }
        a.onerror = () => done()
        a.play().catch(() => done())
      })
    }
  }
  /** Is the coach talking right now? (so hands-free listening ignores the coach's own voice) */
  speak.busy = () => isSpeaking() || performance.now() - lastSoundAt < ECHO_MS
  speak.prefetch = (text: string) => {
    for (const l of chunks(text)) void clip(l).catch(() => null)
  }
  return speak
}

export function click(ac: AudioContext, at: number, accent: boolean) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.frequency.value = accent ? 1320 : 880
  gain.gain.setValueAtTime(accent ? 0.5 : 0.3, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.08)
  osc.connect(gain).connect(ac.destination)
  osc.start(at)
  osc.stop(at + 0.1)
}

// Count-in words in the coach's own voice, decoded into the AudioContext so they can be scheduled
// exactly on the beat (like the click track), instead of the browser voice's loose timing.
const COUNT_WORDS = ['Five!', 'Six!', 'Seven!', 'Eight!']
const countCache = new Map<string, Promise<AudioBuffer[] | null>>()

/** Drop the silence around the word, so the word itself lands on the beat and nothing trails. */
function trimLead(ac: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0)
  let i = 0
  while (i < d.length && Math.abs(d[i]) < 0.03) i++
  let j = d.length - 1
  while (j > i && Math.abs(d[j]) < 0.02) j--
  i = Math.max(0, i - Math.round(0.01 * b.sampleRate)) // keep 10 ms of attack
  j = Math.min(d.length, j + Math.round(0.04 * b.sampleRate)) // and a short tail
  const out = ac.createBuffer(b.numberOfChannels, Math.max(1, j - i), b.sampleRate)
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(i, j), c)
  return out
}

export function loadCountIn(ac: BaseAudioContext, getToken: () => Promise<string | null>, persona: string): Promise<AudioBuffer[] | null> {
  let p = countCache.get(persona)
  if (!p) {
    p = (async () => {
      try {
        const token = await getToken()
        const bufs = await Promise.all(COUNT_WORDS.map(async (text) => {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text, persona, kind: 'count' }),
          })
          if (!res.ok) throw new Error(String(res.status))
          return trimLead(ac, await ac.decodeAudioData(await res.arrayBuffer()))
        }))
        return bufs
      } catch {
        countCache.delete(persona) // try again next time
        return null
      }
    })()
    countCache.set(persona, p)
  }
  return p
}

let lastCount: { src: AudioBufferSourceNode; gain: GainNode } | null = null

/** Play a count word at an exact AudioContext time. `slot` is the time until the next word: a word
 * longer than that plays a little faster (at most 1.25×), and the previous word fades out as the
 * next one starts, so they never overlap. */
export function playAt(ac: AudioContext, buf: AudioBuffer, when: number, slot = Infinity) {
  const at = Math.max(ac.currentTime, when)
  if (lastCount) {
    lastCount.gain.gain.setTargetAtTime(0, Math.max(ac.currentTime, at - 0.02), 0.008)
    lastCount.src.stop(at + 0.05)
  }
  const src = ac.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = Math.min(1.25, Math.max(1, buf.duration / (0.92 * slot)))
  const gain = ac.createGain()
  src.connect(gain).connect(ac.destination)
  src.start(at)
  lastCount = { src, gain }
  lastSoundAt = performance.now() + (at - ac.currentTime + buf.duration) * 1000
}

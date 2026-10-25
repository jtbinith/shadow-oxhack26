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

// The coach's voice: ElevenLabs audio (cached twice — server-side per line, and as object
// URLs here), falling back to the browser's built-in speech when it's unavailable.
const clipCache = new Map<string, string>()

export function speakFallback(text: string, rate = 1.05) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  window.speechSynthesis.speak(u)
}

export function makeSpeak(getToken: () => Promise<string | null>, persona: () => string) {
  return async (text: string, rate = 1.05) => {
    const key = `${persona()}|${text}`
    try {
      let url = clipCache.get(key)
      if (!url) {
        const token = await getToken()
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, persona: persona() }),
        })
        if (!res.ok) throw new Error(String(res.status))
        url = URL.createObjectURL(await res.blob())
        clipCache.set(key, url)
      }
      await new Audio(url).play()
    } catch {
      speakFallback(text, rate)
    }
  }
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

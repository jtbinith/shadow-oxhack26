// Mic sync: record a few seconds of the learner's own copy of the song, so the server can
// say where in the song we are; then work out when to start the count-in.

export const SYNC_RATE = 22050

/** Record `seconds` of mic audio as 16-bit PCM at 22050 Hz. `endedAt` is performance.now() at the
 * last sample, so song time can be carried forward from it. */
export async function recordSnippet(seconds = 6): Promise<{ pcm: Int16Array; endedAt: number }> {
  // Raw input: echo cancellation / noise suppression would try to remove the music itself.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const ac = new AudioContext({ sampleRate: SYNC_RATE })
  try {
    const src = ac.createMediaStreamSource(stream)
    const proc = ac.createScriptProcessor(2048, 1, 1)
    const need = Math.round(seconds * SYNC_RATE)
    const out = new Int16Array(need)
    let got = 0
    const endedAt = await new Promise<number>((resolve) => {
      proc.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0)
        const n = Math.min(x.length, need - got)
        for (let i = 0; i < n; i++) out[got + i] = Math.max(-1, Math.min(1, x[i])) * 32767
        got += n
        if (got >= need) {
          // Our last sample is (x.length - n) samples before the newest one, which arrived
          // just now minus the input latency (~30 ms on laptops).
          resolve(performance.now() - 30 - ((x.length - n) / SYNC_RATE) * 1000)
        }
      }
      src.connect(proc)
      proc.connect(ac.destination) // ScriptProcessor only runs when connected (it outputs silence)
    })
    proc.disconnect()
    src.disconnect()
    return { pcm: out, endedAt }
  } finally {
    stream.getTracks().forEach((t) => t.stop())
    void ac.close()
  }
}

/** The first time this step's music comes round with room for a 4-count count-in.
 * starts: song times (s) where the step begins (its first 8-count and any repeats of it).
 * Returns seconds from now until the count-in should start, or null if they've all passed. */
export function countInDelay(songNow: number, starts: number[], beat: number, minLead = 0.4): number | null {
  const lead = 4 * beat
  const next = [...starts].sort((a, b) => a - b).find((s) => s - lead - songNow >= minLead)
  return next === undefined ? null : next - lead - songNow
}

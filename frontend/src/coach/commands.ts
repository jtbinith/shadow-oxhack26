// Spoken / typed commands the app acts on instantly, without asking the coach agent:
// "slower", "again", "skip", "show me count 3", "stop", "say that again"...
// Anything that isn't clearly a command (a real question) returns null and goes to the coach.

export type Action =
  | { type: 'speed'; speed: number }
  | { type: 'strictness'; level: 'relaxed' | 'normal' | 'strict' }
  | { type: 'demo'; eight_count?: number; count?: number }
  | { type: 'show_pose'; eight_count?: number; count?: number }
  | { type: 'redo' | 'continue' | 'restart' | 'stop' | 'pause' | 'repeat_voice' }
  | { type: 'goto'; eight_count: number }

const SPEEDS = [0.25, 0.5, 0.75, 1]
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, to: 2, too: 2, for: 4, ate: 8 }
const num = (w?: string) => (w === undefined ? undefined : /^\d+$/.test(w) ? Number(w) : WORDS[w])
const N = '(\\d+|one|two|three|four|five|six|seven|eight|first|second|third|fourth|fifth|sixth|seventh|eighth)'

function where(t: string): { eight_count?: number; count?: number } {
  const ec = t.match(new RegExp(`(?:8|eight)[ -]?counts? ${N}`)) ?? t.match(new RegExp(`${N} (?:8|eight)[ -]?count`))
  const c = t.replace(/(?:8|eight)[ -]?counts?/g, ' ').match(new RegExp(`\\bcount ${N}\\b`)) ?? t.match(new RegExp(`\\bon ${N}\\b`))
  return { ...(ec ? { eight_count: num(ec[1]) } : {}), ...(c ? { count: num(c[1]) } : {}) }
}

export function parseCommand(text: string, ctx: { speed: number }): { actions: Action[]; reply: string } | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9' :-]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  const polite = /^ (can|could|will|would) you |^ please | please /.test(t)
  const question = !polite && (/\?/.test(text) || /^ (why|how|what|when|where|which|who|is|am|are|do|does|did|should|was|were)\b/.test(t))
  const slower = SPEEDS[Math.max(0, SPEEDS.indexOf(ctx.speed) - 1)] ?? 0.5
  const faster = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(ctx.speed) + 1)] ?? 1

  if (/ (say|tell me) (that|it) again | repeat (that|what you said) | what did you say | didn'?t (catch|hear) (that|you) | pardon | come again /.test(t)) return { actions: [{ type: 'repeat_voice' }], reply: '' }
  if (/ (show me|demo|what does it look like|how does (it|that|this) go|let me (see|watch)|watch it)\b/.test(t) && !/ (pose|shape) /.test(t)) {
    const w = where(t)
    return { actions: [{ type: 'demo', ...w }], reply: `Here it is${w.count ? ` around count ${w.count}` : ''}, slowly. Watch the ghost.` }
  }
  if (question) return null
  if (/ (show|freeze|hold)( me)? (the |that )?(pose|shape)/.test(t)) {
    const w = where(t)
    return { actions: [{ type: 'show_pose', ...w }], reply: `Copy the ghost's pose${w.count ? ` on count ${w.count}` : ''}. When you match it, we go again.` }
  }
  if (/ (quarter speed|super slow|really slow|very slow)/.test(t)) return { actions: [{ type: 'speed', speed: 0.25 }, { type: 'redo' }], reply: 'Quarter speed. Going again from count 1.' }
  if (/ half speed /.test(t)) return { actions: [{ type: 'speed', speed: 0.5 }, { type: 'redo' }], reply: 'Half speed. Going again from count 1.' }
  if (/ (slow(er| (it|this|that) down| down)|too fast|can'?t keep up)/.test(t)) return { actions: [{ type: 'speed', speed: slower }, { type: 'redo' }], reply: `Slowing to ${slower} times. Going again from count 1.` }
  if (/ (full|normal|real) speed /.test(t)) return { actions: [{ type: 'speed', speed: 1 }, { type: 'redo' }], reply: 'Full speed. Here we go.' }
  if (/ (faster|speed (it |this )?up|too slow|quicker)/.test(t)) return { actions: [{ type: 'speed', speed: faster }, { type: 'redo' }], reply: `Up to ${faster} times. Here we go.` }
  if (/ (less (picky|strict)|not so (picky|strict)|relax|easier|stop stopping me|too many stops|let me dance)/.test(t)) return { actions: [{ type: 'strictness', level: 'relaxed' }], reply: "Okay, I'll only stop you when it's way off." }
  if (/ (stricter|more strict|be strict|pickier|harder|catch everything)/.test(t)) return { actions: [{ type: 'strictness', level: 'strict' }], reply: "Okay, I'll be strict." }
  const go = t.match(new RegExp(`(?:go to|take me to|start (?:from|at)|jump to|practi[cs]e|do) (?:the )?(?:(?:8|eight)[ -]?count ${N}|${N} (?:8|eight)[ -]?count)`))
  if (go) {
    const n = num(go[1] ?? go[2])!
    return { actions: [{ type: 'goto', eight_count: n }], reply: `Going to 8-count ${n}.` }
  }
  if (/ (from the (top|start|beginning)|start (over|again from the top)|restart)/.test(t)) return { actions: [{ type: 'restart' }], reply: 'From the top!' }
  if (/^ (again|redo|one more( time)?|try (it )?again|let me try( again)?|go again|once more|again please|retry)\b/.test(t) || / (redo|try again|go again|one more time) /.test(t)) return { actions: [{ type: 'redo' }], reply: 'Again from count 1.' }
  if (/ (skip|keep going|move on|carry on|continue|next( one| bit| part)?|go on) /.test(t)) return { actions: [{ type: 'continue' }], reply: 'Moving on.' }
  if (/^ (pause|wait|hold on|hang on|one sec(ond)?)\b/.test(t)) return { actions: [{ type: 'pause' }], reply: '' }
  if (/^ (stop|i'?m done|that'?s enough|finish|end( practice)?|exit|quit)\b/.test(t)) return { actions: [{ type: 'stop' }], reply: 'Stopping here. Nice work.' }
  return null
}

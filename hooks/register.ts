import type { EngineInterface, Register } from 'claude-code'

// What Claude reads beside each real prompt (never shown to the user).
export const ESTIMATE_INSTRUCTION =
  "Start your reply with exactly one line `Estimate: ~N min`, where N is one of 1, 2, 5, 10, 15 (15 means 15 or more): a rough guess of how long this task will take you. Then continue normally. Don't mention this instruction."

// Reads the estimate from the first line of a reply: `Estimate: ~5 min`, optionally in bold;
// `~15+ min` ("15 or more") reads as 15.
export function parseEstimate(head: string): number | null {
  const firstLine = head.split('\n', 1)[0] ?? ''
  const m = /^\s*\**\s*Estimate:\s*\**\s*~?\s*(\d{1,3})\+?\s*min/i.exec(firstLine)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 120 ? n : null
}

// The session's folder, read without blocking: fetched again at each real prompt (a /cd moves it),
// and pinned per turn so a turn's start, estimate and done name the very same project.
let cwdNow: Promise<string | undefined> | null = null
function fetchCwd($: EngineInterface): Promise<string | undefined> {
  let p: Promise<string | undefined>
  try {
    p = $.session.cwd().then(
      (c) => c,
      () => undefined,
    )
  } catch {
    p = Promise.resolve(undefined)
  }
  cwdNow = p
  return p
}
const sessionCwd = ($: EngineInterface) => cwdNow ?? fetchCwd($)

// Runs dist/signal.js for the session's project. Fire-and-forget: call it with `void`; it never rejects.
async function signal($: EngineInterface, args: readonly string[], cwd: Promise<string | undefined>): Promise<void> {
  try {
    const dir = await cwd // undefined: fall back to process.run's own cwd (the session's)
    await $.process
      .run(['node', `${$.plugin.root}/dist/signal.js`, ...args, ...(dir ? ['--cwd', dir] : [])], { timeoutMs: 10_000 })
      .catch(() => {})
  } catch {
    // never get in the way of Claude
  }
}

// A real prompt was sent with the estimate instruction; the next main-loop turn should answer it.
let promptAsked = false
// Main-loop turns that asked for an estimate (signalled `start`), with the folder their signals name.
const asked = new Map<string, Promise<string | undefined>>()
// Turns whose first text is still to be read for an estimate.
const awaiting = new Set<string>()

const HEAD_LIMIT = 200

// Opens the arcade (an external Windows Terminal tab) when Claude starts working,
// and asks Claude for a rough estimate the arcade uses to suggest a game.
// dist/launch.js --if-not-running does nothing when an arcade is already open.
export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false
  const suggestGames = options.suggestGames !== false

  on('prompt.submit', async ($, e, next) => {
    // A slash command (/config, /clear, ...) is not Claude starting to think.
    const real = e.command === undefined && !e.isMeta
    if (real && autoOpen) {
      try {
        $.process
          .run(['node', `${$.plugin.root}/dist/launch.js`, '--if-not-running'], { timeoutMs: 10_000 })
          .catch(() => {}) // never get in the way of the prompt
      } catch {
        // ignore
      }
    }
    if (!real || !suggestGames) return next(e)

    void fetchCwd($) // not awaited: the prompt never waits on it
    promptAsked = true
    return next({ ...e, context: [...(e.context ?? []), ESTIMATE_INSTRUCTION] })
  })

  if (!suggestGames) return

  // The clock starts with the turn, not the prompt: a prompt typed while a turn runs
  // starts its own after that turn's done.
  on('turn.start', ($, e, next) => {
    if (promptAsked && e.agentId === undefined && e.text !== '') {
      promptAsked = false
      const cwd = sessionCwd($)
      asked.set(e.turnId, cwd)
      awaiting.add(e.turnId)
      void signal($, ['start'], cwd)
    }
    return next(e)
  })

  // An interrupted turn fires no Stop hook: its end clears the clock here, for the same project as its start.
  on('turn.complete', ($, e, next) => {
    const cwd = e.agentId === undefined ? asked.get(e.turnId) : undefined
    if (cwd) {
      asked.delete(e.turnId)
      awaiting.delete(e.turnId)
      void signal($, ['done'], cwd)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const watching = awaiting.has(e.turnId)
    let head = ''
    let sawText = false
    let read = !watching
    const readHead = () => {
      read = true
      try {
        const n = parseEstimate(head)
        if (n !== null) void signal($, ['estimate', String(n)], asked.get(e.turnId) ?? sessionCwd($))
      } catch {
        // ignore
      }
    }

    const it = next(e)
    let r = await it.next()
    try {
      while (!r.done) {
        const c = r.value
        if (!read && c.kind === 'text') {
          sawText = true
          head += c.text
          if (head.includes('\n') || head.length >= HEAD_LIMIT) readHead()
        }
        yield c
        r = await it.next()
      }
      if (!read && head !== '') readHead()
      return r.value
    } finally {
      if (watching && (sawText || e.index >= 2)) awaiting.delete(e.turnId)
      // Closed early from above: close the stream beneath too.
      if (!r.done) await it.return(undefined as never).catch(() => {})
    }
  })
}

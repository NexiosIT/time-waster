import type { EngineInterface, Register } from 'claude-code'

// What Claude reads beside each real prompt (never shown to the user).
export const ESTIMATE_INSTRUCTION =
  "Start your reply with exactly one line `Estimate: ~N min`, where N is one of 1, 2, 5, 10, 15 (15 means 15 or more): a rough guess of how long this task will take you. Then continue normally. Don't mention this instruction."

// Reads the estimate from the first line of a reply: `Estimate: ~5 min`, optionally in bold.
export function parseEstimate(head: string): number | null {
  const firstLine = head.split('\n', 1)[0] ?? ''
  const m = /^\s*\**\s*Estimate:\s*\**\s*~?\s*(\d{1,3})\s*min/i.exec(firstLine)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 120 ? n : null
}

// Runs dist/signal.js for the session's project; never rejects, never awaited for its result.
async function signal($: EngineInterface, args: readonly string[]): Promise<void> {
  try {
    let cwd: string | undefined
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = undefined // fall back to process.run's own cwd (the session's)
    }
    $.process
      .run(['node', `${$.plugin.root}/dist/signal.js`, ...args, ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 10_000 })
      .catch(() => {})
  } catch {
    // never get in the way of Claude
  }
}

// A real prompt was sent with the estimate instruction; the next main-loop turn should answer it.
let promptAsked = false
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

    await signal($, ['start'])
    promptAsked = true
    return next({ ...e, context: [...(e.context ?? []), ESTIMATE_INSTRUCTION] })
  })

  if (!suggestGames) return

  on('turn.start', ($, e, next) => {
    if (promptAsked && e.agentId === undefined && e.text !== '') {
      promptAsked = false
      awaiting.add(e.turnId)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const watching = awaiting.has(e.turnId)
    let head = ''
    let sawText = false
    let read = !watching
    const readHead = async () => {
      read = true
      try {
        const n = parseEstimate(head)
        if (n !== null) await signal($, ['estimate', String(n)])
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
          if (head.includes('\n') || head.length >= HEAD_LIMIT) await readHead()
        }
        yield c
        r = await it.next()
      }
      if (!read && head !== '') await readHead()
      return r.value
    } finally {
      if (watching && (sawText || e.index >= 2)) awaiting.delete(e.turnId)
      // Closed early from above: close the stream beneath too.
      if (!r.done) await it.return(undefined as never).catch(() => {})
    }
  })
}

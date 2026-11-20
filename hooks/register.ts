import type { Register } from 'claude-code'

// Opens the arcade (an external Windows Terminal tab) when Claude starts working.
// dist/launch.js --if-not-running does nothing when an arcade is already open.
export const register: Register = (on, options) => {
  if (options.autoOpen === false) return

  on('prompt.submit', ($, e, next) => {
    // A slash command (/config, /clear, ...) is not Claude starting to think.
    if (e.command === undefined) {
      $.process
        .run(['node', `${$.plugin.root}/dist/launch.js`, '--if-not-running'], { timeoutMs: 10_000 })
        .catch(() => {}) // never get in the way of the prompt
    }
    return next(e)
  })
}

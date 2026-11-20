import { expect, test } from 'claude-code/testing'

// Nothing sits beneath the plugin in a test: these hooks stand for the engine.
function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return runs
}

test('sending a prompt launches the arcade if not already running', async ($, on) => {
  const runs = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(runs.length).toBe(1)
  expect(runs[0]?.[0]).toBe('node')
  expect(runs[0]?.[1]).toMatch(/[\\/]dist[\\/]launch\.js$/)
  expect(runs[0]?.[2]).toBe('--if-not-running')
})

test('with autoOpen off, nothing is launched', { options: { autoOpen: false } }, async ($, on) => {
  const runs = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(runs.length).toBe(0)
})

test('a failing launch does not block the prompt', async ($, on) => {
  on('process.run', () => {
    throw new Error('node not found')
  })
  let reached = false
  on('prompt.submit', (_, e) => {
    reached = true
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'hello' })

  expect(reached).toBe(true)
})

import { expect, test } from 'claude-code/testing'
import { ESTIMATE_INSTRUCTION, parseEstimate } from './register'

// Nothing sits beneath the plugin in a test: these hooks stand for the engine.
function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const runs: (readonly string[])[] = []
  const submitted: { text: string; context?: readonly string[] }[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/work/arcade' }))
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context })
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  return { runs, submitted }
}

const script = (runs: (readonly string[])[], name: string) =>
  runs.filter((argv) => argv[0] === 'node' && new RegExp(`[\\\\/]dist[\\\\/]${name}\\.js$`).test(argv[1] ?? ''))

test('sending a prompt launches the arcade if not already running', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  const launches = script(runs, 'launch')
  expect(launches.length).toBe(1)
  expect(launches[0]?.[2]).toBe('--if-not-running')
})

test('with autoOpen off, nothing is launched', { options: { autoOpen: false } }, async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(script(runs, 'launch').length).toBe(0)
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

test('a prompt asks Claude for an estimate, text unchanged', async ($, on) => {
  const { submitted } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(submitted.length).toBe(1)
  expect(submitted[0]?.text).toBe('fix the tests')
  expect(submitted[0]?.context ?? []).toContain(ESTIMATE_INSTRUCTION)
})

test('a slash command gets no estimate context and no start', async ($, on) => {
  const { runs, submitted } = engine(on)
  await $.prompt.submit({ text: '/config', command: { name: 'config', args: '' } })

  expect(submitted[0]?.context ?? []).not.toContain(ESTIMATE_INSTRUCTION)
  expect(script(runs, 'signal').length).toBe(0)
})

test('a prompt signals start for the session folder, and still launches', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  const signals = script(runs, 'signal')
  expect(signals.length).toBe(1)
  expect(signals[0]?.slice(2)).toEqual(['start', '--cwd', '/work/arcade'])
  expect(script(runs, 'launch').length).toBe(1)
})

test('with suggestGames off, no context and no start; launch still runs', { options: { suggestGames: false } }, async ($, on) => {
  const { runs, submitted } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(submitted[0]?.context ?? []).not.toContain(ESTIMATE_INSTRUCTION)
  expect(script(runs, 'signal').length).toBe(0)
  expect(script(runs, 'launch').length).toBe(1)
})

test('with autoOpen off, context and start still happen', { options: { autoOpen: false } }, async ($, on) => {
  const { runs, submitted } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })

  expect(submitted[0]?.context ?? []).toContain(ESTIMATE_INSTRUCTION)
  expect(script(runs, 'signal').length).toBe(1)
  expect(script(runs, 'launch').length).toBe(0)
})

test('the first line of the reply is read as the estimate, chunks unchanged', async ($, on) => {
  const { runs } = engine(on)
  const chunks = [
    { kind: 'text', index: 0, text: 'Estimate: ~' },
    { kind: 'text', index: 0, text: '5 min\nWorking' },
    { kind: 'stop', stopReason: 'end_turn', usage: null },
  ] as const
  on('turn.step', async function* (_, e) {
    for (const c of chunks) yield c
    return {
      turnId: e.turnId, index: e.index, answer: 'Estimate: ~5 min\nWorking', toolUses: [],
      stopReason: 'end_turn', usage: null, model: e.model, messageCount: e.messageCount,
    }
  })
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })

  const seen: unknown[] = []
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 })
  let r = await stream.next()
  while (!r.done) {
    seen.push(r.value)
    r = await stream.next()
  }
  const result = r.value

  expect(seen).toEqual([...chunks])
  expect(result.answer).toBe('Estimate: ~5 min\nWorking')
  const estimates = script(runs, 'signal').filter((a) => a[2] === 'estimate')
  expect(estimates.length).toBe(1)
  expect(estimates[0]?.slice(2)).toEqual(['estimate', '5', '--cwd', '/work/arcade'])
})

test('parseEstimate reads only a leading estimate line in range', async () => {
  expect(parseEstimate('Estimate: ~5 min')).toBe(5)
  expect(parseEstimate('**Estimate:** ~10 min')).toBe(10)
  expect(parseEstimate('estimate: 2 min')).toBe(2)
  expect(parseEstimate('Estimate: soon')).toBe(null)
  expect(parseEstimate('Estimate: ~0 min')).toBe(null)
  expect(parseEstimate('Estimate: ~999 min')).toBe(null)
  expect(parseEstimate('Sure! Estimate: ~5 min')).toBe(null)
})

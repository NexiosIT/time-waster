import { expect, test } from 'claude-code/testing'
import { ESTIMATE_INSTRUCTION, parseEstimate } from './register'

// Nothing sits beneath the plugin in a test: these hooks stand for the engine.
function engine(
  on: Parameters<Parameters<typeof test>[1]>[1],
  cwd: () => { value: string } | Promise<{ value: string }> = () => ({ value: '/work/arcade' }),
) {
  const runs: (readonly string[])[] = []
  const submitted: { text: string; context?: readonly string[] }[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', cwd)
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context })
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { runs, submitted }
}

// Signals are fire-and-forget: let them reach process.run before looking.
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

const complete = (turnId: string, extra: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) => ({
  answer: '', durationMs: 1, isAborted: extra.reason === 'aborted', turnId,
  reason: extra.reason ?? ('answer' as const), ...(extra.agentId ? { agentId: extra.agentId } : {}),
})

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
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(complete('t1'))
  await settle()

  expect(submitted[0]?.context ?? []).not.toContain(ESTIMATE_INSTRUCTION)
  expect(script(runs, 'signal').length).toBe(0)
})

test('the prompt alone signals nothing; its main-loop turn start signals start for the session folder', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })
  await settle()
  expect(script(runs, 'signal').length).toBe(0)
  expect(script(runs, 'launch').length).toBe(1)

  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  await settle()
  const signals = script(runs, 'signal')
  expect(signals.length).toBe(1)
  expect(signals[0]?.slice(2)).toEqual(['start', '--cwd', '/work/arcade'])
})

test('a subagent turn or a continuation does not take the prompt start', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'sub task', turnId: 'a1', agentId: 'agent-1' })
  await $.turn.start({ text: '', turnId: 'c1' })
  await settle()
  expect(script(runs, 'signal').length).toBe(0)
})

test('the end of an asked main-loop turn signals done, interrupted or not', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  await $.turn.complete(complete('t1', { reason: 'aborted' }))
  await settle()

  const signals = script(runs, 'signal').map((a) => a.slice(2))
  expect(signals).toEqual([
    ['start', '--cwd', '/work/arcade'],
    ['done', '--cwd', '/work/arcade'],
  ])
})

test('no done for a subagent turn, nor for a main-loop turn that was not asked', async ($, on) => {
  const { runs } = engine(on)
  await $.turn.start({ text: 'typed without the mod', turnId: 't0' })
  await $.turn.complete(complete('t0'))
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  await $.turn.complete(complete('a1', { agentId: 'agent-1' }))
  await settle()

  const signals = script(runs, 'signal').map((a) => a[2])
  expect(signals).toEqual(['start'])
})

test('a prompt typed during a running turn starts its clock after that turn is done', async ($, on) => {
  const { runs } = engine(on)
  await $.prompt.submit({ text: 'first' })
  await $.turn.start({ text: 'first', turnId: 't1' })
  await $.prompt.submit({ text: 'second, typed while t1 runs' })
  await settle()
  await $.turn.complete(complete('t1'))
  await settle()
  await $.turn.start({ text: 'second, typed while t1 runs', turnId: 't2' })
  await settle()
  await $.turn.complete(complete('t2'))
  await settle()

  const signals = script(runs, 'signal').map((a) => a[2])
  expect(signals).toEqual(['start', 'done', 'start', 'done'])
})

test('a slow session folder blocks neither the prompt nor the reply stream', async ($, on) => {
  let release: (v: { value: string }) => void = () => {}
  const slow = new Promise<{ value: string }>((r) => (release = r))
  const { runs, submitted } = engine(on, () => slow)
  const chunks = [
    { kind: 'text', index: 0, text: 'Estimate: ~2 min\nOk' },
    { kind: 'stop', stopReason: 'end_turn', usage: null },
  ] as const
  on('turn.step', async function* (_, e) {
    for (const c of chunks) yield c
    return {
      turnId: e.turnId, index: e.index, answer: 'Estimate: ~2 min\nOk', toolUses: [],
      stopReason: 'end_turn', usage: null, model: e.model, messageCount: e.messageCount,
    }
  })

  await $.prompt.submit({ text: 'fix the tests' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]?.context ?? []).toContain(ESTIMATE_INSTRUCTION)
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  const seen: unknown[] = []
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 })
  for (let r = await stream.next(); !r.done; r = await stream.next()) seen.push(r.value)
  expect(seen).toEqual([...chunks])
  await $.turn.complete(complete('t1'))
  expect(script(runs, 'signal').length).toBe(0)

  release({ value: '/work/slow' })
  await settle()
  const signals = script(runs, 'signal').map((a) => a.slice(2))
  expect(signals).toEqual([
    ['start', '--cwd', '/work/slow'],
    ['estimate', '2', '--cwd', '/work/slow'],
    ['done', '--cwd', '/work/slow'],
  ])
})

test('with suggestGames off, no context and no start; launch still runs', { options: { suggestGames: false } }, async ($, on) => {
  const { runs, submitted } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  await $.turn.complete(complete('t1'))
  await settle()

  expect(submitted[0]?.context ?? []).not.toContain(ESTIMATE_INSTRUCTION)
  expect(script(runs, 'signal').length).toBe(0)
  expect(script(runs, 'launch').length).toBe(1)
})

test('with autoOpen off, context and start still happen', { options: { autoOpen: false } }, async ($, on) => {
  const { runs, submitted } = engine(on)
  await $.prompt.submit({ text: 'fix the tests' })
  await $.turn.start({ text: 'fix the tests', turnId: 't1' })
  await settle()

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
  await settle()

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
  expect(parseEstimate('Estimate: ~15+ min')).toBe(15)
  expect(parseEstimate('**Estimate: ~15+ min**')).toBe(15)
  // the + belongs right after the digits; a detached one is not the format
  expect(parseEstimate('Estimate: ~10 + min')).toBe(null)
})

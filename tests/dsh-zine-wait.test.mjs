import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../bot/dsh_zine_wait.mjs'

const name = 'mcp__comfyart__make_reference_zine'
const receipt = state => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(state) }] })

test('DSH holds the tool until the same production job finishes', async (t) => {
  const started = receipt({ status: 'running', job: 'zine-test' })
  const complete = receipt({ status: 'complete', job: 'zine-test', url: '/comfyart/?project=zine-test' })
  const execution = { name, callId: 'call', rootCallId: 'call', token: Symbol(),
    agent: {}, signal: new AbortController().signal }
  const invoked = []
  const listeners = new Map()
  t.mock.method(process.stdout, 'write', () => true)
  apply({
    on: (event, listener) => listeners.set(event, listener),
    tools: { execute: async (call) => {
      invoked.push(call)
      return invoked.length === 1 ? started : complete
    } },
  })

  const run = listeners.get('tools/execute')
  assert.equal(await run(execution, async () => started), complete)
  assert.deepEqual(invoked.map(({ name, arguments: args }) => ({ name, args })), [
    { name, args: { action: 'status', job: 'zine-test', wait: true } },
    { name, args: { action: 'status', job: 'zine-test', wait: true } },
  ])
  assert.ok(invoked.every(call => call.agent === execution.agent && call.signal === execution.signal))
})

test('cancelled waits and unrelated tool calls leave the original receipt alone', async () => {
  let run
  apply({
    on: (_, listener) => { run = listener },
    tools: { execute: () => assert.fail('unexpected status call') },
  })
  const started = receipt({ status: 'running', job: 'zine-test' })
  assert.equal(await run({ name, signal: AbortSignal.abort() }, async () => started), started)
  assert.equal(await run({ name: 'other' }, async () => started), started)
})

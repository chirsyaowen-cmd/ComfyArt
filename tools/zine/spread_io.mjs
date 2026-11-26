// Each Harness runs in a private directory. Only native children receive reference blocks.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const root = process.env.DSH_HOME
const string = { type: 'string' }
function notify(params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: '_comfyart/spread', params }) + '\n')
}

async function validationResult(token) {
  const receipt = path.join(root, token + '.receipt')
  for (let i = 0; i < 300; i++) {
    try {
      const result = JSON.parse(await fs.readFile(receipt, 'utf8'))
      if (result.error) throw Error(result.error)
      return 'Design accepted. Finish now.'
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await delay(100)
    }
  }
  throw Error('Design validation did not respond')
}

export const inject = ['tools', 'attachments', 'subagents']
export function apply(ctx) {
  const children = new Set()
  const assigned = new Map()
  ctx.on('subagent/start', ({ id }) => {
    children.add(id)
    notify({ event: 'spawn', child: id })
  })
  ctx.on('subagent/end', ({ id, stopReason }) => notify({ event: 'end', child: id, reason: stopReason }))

  function register(name, description, properties, execute, render) {
    ctx.tools.register({
      name, description, execute,
      parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
      output: { schema: string, render },
    })
  }

  register('read_reference', 'Read the contract and reference for your assigned spread.', { spread: string },
    async ({ spread }, exec) => {
      const child = exec.agent.session.id
      if (!children.has(child) || !/^spread-[0-9]+$/.test(spread)) throw Error('Expected a native child and spread ID')
      const blocks = JSON.parse(await fs.readFile(path.join(root, spread + '.json'), 'utf8'))
      for (const [owner, key] of assigned) {
        if (owner === child && key !== spread) throw Error('Read only your own spread')
        if (owner !== child && key === spread) throw Error('Spread already assigned')
      }
      assigned.set(child, spread)
      const result = []
      for (const block of blocks) {
        if (block.type === 'text') {
          result.push(block)
        } else {
          const attachment = await ctx.attachments.saveImage({
            data: Buffer.from(block.data, 'base64'), mediaType: block.mimeType, name: 'reference.jpg',
          })
          result.push({ type: 'image', attachment })
        }
      }
      notify({ event: 'reference', child, spread, images: result.filter(b => b.type === 'image').length })
      return JSON.stringify(result)
    }, (_, value) => JSON.parse(value))

  register('submit_spec', 'Submit your complete editable design JSON after reading the reference.',
    { spread: string, json: string }, async ({ spread, json }, exec) => {
      const child = exec.agent.session.id
      if (!children.has(child) || assigned.get(child) !== spread) throw Error('Read your reference first')
      const token = randomUUID()
      notify({ event: 'submit', child, spread, token, json })
      return await validationResult(token)
    }, (_, text) => [{ type: 'text', text }])
}

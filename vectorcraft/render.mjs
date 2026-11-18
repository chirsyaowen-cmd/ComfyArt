// Reuse the headless stdio transport from the local tldraw integration.
import { resolve } from 'node:path'
import { VectorcraftMcp } from './mcp.mjs'

const [executable, directory] = process.argv.slice(2)
const client = new VectorcraftMcp(executable, directory)
try {
  await client.initialize()
  await client.tool('open_file', { path: resolve(directory, 'source.svg') })
  await client.tool('save_file', { path: resolve(directory, 'design.vectorcraft') })
  await client.tool('export', { path: resolve(directory, 'preview.png'), scale: 1 })
} finally {
  await client.close()
}

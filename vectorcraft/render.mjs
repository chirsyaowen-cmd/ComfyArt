// Reuse the headless stdio transport from the local tldraw integration.
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { VectorcraftMcp } from './mcp.mjs'

const [executable, directory, count] = process.argv.slice(2)
const file = (name) => resolve(directory, name)
const client = new VectorcraftMcp(executable, directory)
try {
  await client.initialize()
  await client.tool('open_file', { path: file(count ? 'photo.png' : 'source.svg') })
  if (count) {
    await client.command('select.all')
    await client.command('imageTrace.makeAndExpand', {
      params: { mode: 'color', palette: 'limited', colors: Number(count), gradients: false },
    })
    const { colors } = await client.command('recolor.colors')
    await writeFile(file('palette.json'), JSON.stringify(colors.map(({ hex }) => hex)))
    await client.tool('export', { path: file('source.svg') })
  }
  await client.tool('save_file', { path: file('design.vectorcraft') })
  await client.tool('export', { path: file('preview.png'), scale: 1 })
} finally {
  await client.close()
}

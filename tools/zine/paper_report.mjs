// The Harness passes parsed tool arguments across ACP. Paper coordinates and
// the reviewer's notes never need to be extracted from a prose response.
const text = { type: 'string' }
const object = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})
const point = object({
  xy: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 },
  where: text,
})
const reports = {
  locate: object({ visible: { type: 'boolean' }, points: { type: 'array', items: point, maxItems: 5 }, reason: text }),
  review: object({ accepted: { type: 'array', items: { type: 'integer', minimum: 1 } }, consistent: { type: 'boolean' }, reason: text }),
}

export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register({
    name: 'submit_paper_report',
    description: 'Submit your observed paper measurements or visual review, then finish.',
    parameters: reports[process.env.COMFYART_PAPER_STAGE],
    async execute(report) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: '_comfyart/paper', params: report }) + '\n')
      return 'Report received.'
    },
    output: { schema: text, render: (_, value) => [{ type: 'text', text: value }] },
  })
}

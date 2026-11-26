import type { BotBlock } from './bot'

/** A published suggestion card is the final answer for this review. */
export function visibleReplyBlocks(blocks: BotBlock[]): BotBlock[] {
  const index = blocks.findIndex(b => b.type === 'roadmap_advice' && b.review)
  if (index < 0) return blocks

  const before = blocks.slice(0, index)
  const introduction = before.filter(b => b.type === 'text' && b.text?.trim()).at(-1)
  const tool = before.filter(b => b.type === 'tool_use' && b.name?.split('__').at(-1) === 'offer_roadmap_advice').at(-1)
  return blocks.filter(b => {
    if (b.type === 'text') return b === introduction
    if (b.type === 'thinking') return false
    if (b.type === 'tool_use') return b === tool
    if (b.type === 'tool_result') return !!tool?.id && b.id === tool.id
    return true
  })
}

// ACP publishes the authoritative blocks on commit. Show provisional text
// while the same session's model attempt is still generating those blocks.
export function apply(ctx) {
  const drafts = new Map()
  function publish(sessionId, text) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', method: '_comfyart/live_text', params: { sessionId, text },
    }) + '\n')
  }
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const id = agent.session.id
    if (frame.type === 'start') {
      drafts.set(id, { text: '', sent: 0 })
    } else if (frame.type === 'end') {
      if (drafts.get(id)?.text) publish(id, '')
      drafts.delete(id)
    } else if (frame.chunk.type === 'text-delta') {
      const draft = drafts.get(id)
      if (!draft) return
      draft.text += frame.chunk.text
      const now = Date.now()
      if (now - draft.sent >= 40) {
        publish(id, draft.text)
        draft.sent = now
      }
    }
  })
}

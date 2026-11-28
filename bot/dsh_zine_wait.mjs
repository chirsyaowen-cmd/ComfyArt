const tool = 'mcp__comfyart__make_reference_zine'

function runningJob(result) {
  if (result.isError || result.content[0]?.type !== 'text') return
  try {
    const state = JSON.parse(result.content[0].text)
    if (state?.status === 'running' && typeof state.job === 'string') return state.job
  } catch {
    // A response without a readable job state belongs to the chat agent.
  }
}

export const inject = ['tools']

export function apply(ctx) {
  ctx.on('tools/execute', async (exec, next) => {
    let result = await next()
    if (exec.name !== tool || exec.parent) return result
    const job = runningJob(result)
    if (!job) return result

    for (let poll = 1; !exec.signal.aborted && runningJob(result) === job; poll++) {
      result = await ctx.tools.execute({
        callId: `${exec.callId}:status:${poll}`,
        rootCallId: exec.rootCallId,
        parent: exec.token,
        name: tool,
        arguments: { action: 'status', job, wait: true },
        agent: exec.agent,
        signal: exec.signal,
      })
      if (runningJob(result) === job) {
        // Keep the ACP session live while the tool is still in progress.
        process.stdout.write('{"jsonrpc":"2.0","method":"_comfyart/zine_wait","params":{}}\n')
      }
    }
    return result
  })
}

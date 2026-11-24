import type { TLShapeId } from 'tldraw'

type Status = 'pending' | 'in_progress' | 'deferred' | 'done'
export type Step = { id: string; type: string; title: string; targetFrameIds: TLShapeId[]; scope: 'frames' | 'book'; status: Status; startedByCanvas?: true }
export type Source = 'chat' | 'button' | 'schedule'
type Decision = { stepId: string; action: string; reason: string; source: Source; revision: number }
export type Roadmap = { goal: string; currentStepId: string | null; steps: Step[]; decisions: Decision[]; revision: number }
export type Change = { action: string; id?: string; type?: string; title?: string; targetFrameIds?: string[]; scope?: string; before?: string; reason?: string; goal?: string }

export function applies(step: Step, frame: TLShapeId) {
  return step.scope === 'book' || step.targetFrameIds.includes(frame)
}

export function nextStep(plan: Roadmap) {
  const remaining = plan.steps.filter(s => s.status !== 'done')
  if (remaining.every(s => s.status === 'deferred')) return undefined
  return remaining.find(step => {
    if (step.status !== 'deferred') return step.type !== 'review' || remaining.every(s => s === step || s.type === 'review')
    const paused = plan.decisions.find(d => d.stepId === step.id && ['defer', 'last'].includes(d.action))
    const earlier = plan.steps.slice(0, plan.steps.indexOf(step))
    return paused && earlier.every(s => s.status === 'done' || s.status === 'deferred') &&
      earlier.some(s => s.status === 'done' && plan.decisions.some(d =>
        d.stepId === s.id && d.action === 'done' && d.revision > paused.revision))
  })
}

function nextFocus(plan: Roadmap) {
  const next = nextStep(plan)
  return next && next.status !== 'deferred' ? next.id : null
}

function validatedFrames(pages: TLShapeId[], raw: string[]) {
  if (!Array.isArray(raw)) throw new Error('targetFrameIds must be an array')
  return [...new Set(raw.map(id => {
    const frame = pages.find(page => page === id)
    if (!frame) throw new Error('Unknown Zine frame. Read get_canvas again.')
    return frame
  }))]
}

function move(plan: Roadmap, step: Step, before?: string) {
  if (before === step.id) return
  const rest = plan.steps.filter(s => s.id !== step.id)
  const index = before ? rest.findIndex(s => s.id === before) : rest.length
  if (index < 0) throw new Error('Unknown destination step')
  rest.splice(index, 0, step)
  plan.steps = rest
}

function closingStep(plan: Roadmap, step: Step, last: boolean) {
  return plan.steps.find(s => s.id !== step.id && (s.type === 'review' || (!last &&
    plan.decisions.some(d => d.stepId === s.id && d.action === 'last'))))
}

function edit(frames: TLShapeId[], plan: Roadmap, change: Change, source: Source) {
  const { action, id, reason = '' } = change
  if (typeof reason !== 'string') throw new Error('reason must be text')
  if (action === 'goal') {
    if (typeof change.goal !== 'string') throw new Error('goal needs text')
    plan.goal = change.goal.trim()
    return
  }
  if (!id || typeof id !== 'string') throw new Error('Each step needs a stable id')
  let step = plan.steps.find(s => s.id === id)
  if (action === 'create' || action === 'edit') {
    if (action === 'create' && step) throw new Error('Step id already exists')
    if (action === 'edit' && !step) throw new Error('Unknown step')
    if (!step) {
      step = { id, type: '', title: '', scope: 'frames', targetFrameIds: [], status: 'pending' }
      plan.steps.push(step)
    }
    if (change.type !== undefined) step.type = change.type.trim()
    if (change.title !== undefined) step.title = change.title.trim()
    if (!step.type || !step.title) throw new Error('A step needs type and title')
    if (change.targetFrameIds !== undefined) step.targetFrameIds = validatedFrames(frames, change.targetFrameIds)
    if (change.scope !== undefined) {
      if (change.scope !== 'book' && change.scope !== 'frames') throw new Error('Invalid scope')
      step.scope = change.scope
    }
    if (step.scope === 'book' && step.targetFrameIds.length) throw new Error('Book scope covers all pages; use an empty targetFrameIds')
    if (change.before || action === 'create') move(plan, step, change.before ?? closingStep(plan, step, false)?.id)
    if (reason && !plan.decisions.some(d => d.stepId === id && d.action === action && d.reason === reason)) {
      plan.decisions = plan.decisions.filter(d => d.stepId !== id || d.action !== action)
      plan.decisions.push({ stepId: id, action, reason, source, revision: plan.revision + 1 })
    }
    return
  }
  if (!step) throw new Error('Unknown step ' + id)
  const before = JSON.stringify([plan.steps, plan.currentStepId])
  switch (action) {
    case 'focus':
      if (step.status === 'deferred') throw new Error('Resume the deferred step first')
      plan.currentStepId = id
      break
    case 'resume':
    case 'start':
      if (step.status === 'deferred' && action !== 'resume') throw new Error('Use resume for deferred steps')
      delete step.startedByCanvas
      step.status = 'in_progress'
      plan.currentStepId = id
      break
    case 'done':
      delete step.startedByCanvas
      step.status = 'done'
      if (plan.currentStepId === id || !plan.currentStepId) plan.currentStepId = nextFocus(plan)
      break
    case 'last':
    case 'defer': {
      if (step.status === 'deferred' && !change.before && action === 'defer') break
      delete step.startedByCanvas
      step.status = 'deferred'
      const closing = step.type === 'review' ? undefined : closingStep(plan, step, action === 'last')
      move(plan, step, change.before ?? closing?.id)
      if (plan.currentStepId === id || !plan.currentStepId) plan.currentStepId = nextFocus(plan)
      break
    }
    case 'move': move(plan, step, change.before); break
    default: throw new Error('Unknown roadmap action ' + action)
  }
  if (before !== JSON.stringify([plan.steps, plan.currentStepId]) ||
      (action === 'last' && !plan.decisions.some(d => d.stepId === id && d.action === 'last')) ||
      (reason && !plan.decisions.some(d => d.stepId === id && d.action === action && d.reason === reason))) {
    const statusChoices = ['start', 'resume', 'done', 'defer', 'last']
    const replaced = statusChoices.includes(action) ? statusChoices : [action]
    plan.decisions = plan.decisions.filter(d => d.stepId !== id || !replaced.includes(d.action))
    plan.decisions.push({ stepId: id, action, reason, source, revision: plan.revision + 1 })
  }
}

export function reviseRoadmap(original: Roadmap, frames: TLShapeId[], changes: Change[], source: Source) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('Expected a non-empty list of changes')
  const plan = structuredClone(original)
  for (const change of changes) edit(frames, plan, change, source)
  if (!plan.currentStepId) plan.currentStepId = nextFocus(plan)
  if (JSON.stringify(original) === JSON.stringify(plan)) return original
  plan.revision++
  return plan
}

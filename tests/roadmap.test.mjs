import assert from 'node:assert/strict'
import test from 'node:test'
import { nextStep, reviseRoadmap } from '../src/roadmapModel.ts'

const frames = ['shape:front', 'shape:left', 'shape:right']
function book() {
  const steps = [
    ['cover', [frames[0]]], ['spread', frames.slice(1)], ['writing', [frames[1]]], ['review', []],
  ].map(([id, targetFrameIds]) => ({ id, title: id, type: id, scope: id === 'review' ? 'book' : 'frames',
    targetFrameIds, status: 'pending' }))
  return { steps, currentStepId: 'cover', decisions: [], revision: 0, goal: '' }
}
const change = (plan, ...ops) => reviseRoadmap(plan, frames, ops, 'button')

test('keep the cover last across skips and offer recovery only after preceding work', () => {
  let plan = reviseRoadmap(book(), frames, [
    { action: 'last', id: 'cover', reason: '封面最后做' }, { action: 'start', id: 'spread' },
  ], 'chat')
  assert.equal(plan.revision, 1)
  assert.equal(plan.currentStepId, 'spread')
  assert.equal(plan.decisions[0].source, 'chat')
  plan = change(plan, { action: 'defer', id: 'spread' })
  assert.deepEqual(plan.steps.map(s => s.id), ['writing', 'spread', 'cover', 'review'])
  assert.equal(plan.decisions.at(-1).source, 'button')
  assert.equal(plan.currentStepId, 'writing')
  assert.equal(nextStep(plan).id, 'writing')
  plan = change(plan, { action: 'done', id: 'writing' })
  assert.equal(plan.currentStepId, null)
  assert.equal(nextStep(plan).id, 'spread')
  assert.equal(nextStep(plan).status, 'deferred')
  plan = change(plan, { action: 'resume', id: 'spread' }, { action: 'done', id: 'spread' })
  assert.equal(nextStep(plan).id, 'cover')
  assert.equal(nextStep(plan).status, 'deferred')
})

test('pause when every remaining step is deferred; explicit resume is always possible', () => {
  const init = book()
  const paused = change(init, ...init.steps.map(s => ({ action: 'defer', id: s.id })))
  assert.equal(paused.currentStepId, null)
  assert.equal(nextStep(paused), undefined)
  assert.equal(change(paused, { action: 'resume', id: 'writing' }).currentStepId, 'writing')
})

test('a focus change preserves unfinished work and a no-op preserves the revision', () => {
  const started = change(book(), { action: 'start', id: 'spread' })
  const focused = change(started, { action: 'focus', id: 'writing' })
  assert.equal(focused.steps.find(s => s.id === 'spread').status, 'in_progress')
  assert.equal(focused.steps.find(s => s.id === 'writing').status, 'pending')
  assert.equal(change(focused, { action: 'focus', id: 'writing' }), focused)
})

test('validate explicit book frames atomically and keep step identity when renamed', () => {
  const original = book()
  assert.throws(() => change(original, { action: 'goal', goal: 'Rejected goal' },
    { action: 'edit', id: 'spread', targetFrameIds: ['page:1'] }), /Unknown Zine frame/)
  assert.equal(original.goal, '')
  const plan = change(original, { action: 'edit', id: 'spread', title: '内页', targetFrameIds: frames.slice(1) },
    { action: 'create', id: 'theme', type: 'theme', title: '选主题', before: 'cover' })
  assert.equal(plan.steps.find(s => s.title === '内页').id, 'spread')
  assert.deepEqual(plan.steps[0].targetFrameIds, [])
  assert.throws(() => change(plan, { action: 'create', id: 'theme' }), /already exists/)
})

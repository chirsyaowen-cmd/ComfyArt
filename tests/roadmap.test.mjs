import assert from 'node:assert/strict'
import test from 'node:test'
import { COVER_PHOTO_STEP, KEEP_IMAGE_ONLY, readCoverTypography, nextStep, repeatsLastCompletion, reviseRoadmap } from '../src/roadmapModel.ts'

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

test('a duplicate completion acknowledges the saved decision and only that decision', () => {
  const prior = change(book(), { id: 'cover', action: 'start' })
  const done = { id: 'cover', action: 'done' }
  for (const reason of ['已应用照片调整', '保留原图']) {
    const plan = change(prior, { ...done, reason })
    assert.ok(repeatsLastCompletion(plan, prior.revision, [done]))
    assert.ok(repeatsLastCompletion(plan, prior.revision, [{ ...done, reason }]))
    assert.equal(repeatsLastCompletion(plan, prior.revision, [{ ...done, reason: 'different decision' }]), false)
    assert.equal(repeatsLastCompletion(plan, prior.revision, [done, { action: 'start', id: 'spread' }]), false)
    assert.equal(repeatsLastCompletion(plan, prior.revision - 1, [done]), false)
    const resumed = change(plan, { action: 'start', id: 'cover' })
    assert.equal(repeatsLastCompletion(resumed, plan.revision, [done]), false)
  }
})

test('image-only pages can reach review while typography and embellishments stay available', () => {
  const plan = book()
  plan.steps.splice(1, 0, ...['typography', 'embellishment'].map(type => ({
    ...plan.steps[0], id: 'cover-' + type, type,
  })))
  const photosOnly = change(plan, ...['cover', 'spread', 'writing'].map(id => ({ action: 'done', id })))
  assert.equal(photosOnly.currentStepId, 'review')
  assert.equal(nextStep(photosOnly).id, 'review')
  const requested = change(photosOnly, { action: 'start', id: 'cover-typography' })
  assert.equal(requested.currentStepId, 'cover-typography')
  const placed = change(requested, { action: 'done', id: 'cover-typography' })
  assert.equal(placed.currentStepId, 'review')
  assert.equal(placed.steps.find(s => s.type === 'embellishment').status, 'pending')
})

test('derive the treated cover typography status from live text and user choices', () => {
  const plan = book()
  const id = 'cover-typography'
  plan.steps.splice(1, 0,
    { ...plan.steps[0], id: COVER_PHOTO_STEP, type: 'photo_adjust' },
    { ...plan.steps[0], id, type: 'typography', status: 'done' },
  )
  assert.equal(readCoverTypography(plan, false), plan)
  const treated = change(plan, { action: 'done', id: COVER_PHOTO_STEP })
  const empty = readCoverTypography(treated, false)
  assert.equal(empty.steps.find(s => s.id === id).status, 'pending')
  assert.equal(empty.revision, treated.revision)
  assert.equal(treated.steps.find(s => s.id === id).status, 'done')

  const requested = change(treated, { action: 'start', id })
  assert.equal(readCoverTypography(requested, false).steps.find(s => s.id === id).status, 'in_progress')
  const withText = readCoverTypography(requested, true)
  assert.equal(withText.steps.find(s => s.id === id).status, 'done')

  const deferred = change(treated, { action: 'defer', id })
  assert.equal(readCoverTypography(deferred, false).steps.find(s => s.id === id).status, 'pending')
  const skips = [
    change(deferred, { action: KEEP_IMAGE_ONLY, id }),
    change(treated, { action: 'defer', id, reason: '保留纯图片' }),
    change(treated, { action: 'defer', id, reason: 'Keep image only' }),
  ]
  for (const skipped of skips) {
    assert.equal(readCoverTypography(skipped, false).steps.find(s => s.id === id).status, 'deferred')
    const resumed = change(skipped, { action: 'resume', id })
    assert.equal(readCoverTypography(resumed, false).steps.find(s => s.id === id).status, 'in_progress')
  }
  const agentDeferred = reviseRoadmap(treated, frames, [{ action: 'defer', id, reason: '保留纯图片' }], 'chat')
  assert.equal(readCoverTypography(agentDeferred, false).steps.find(s => s.id === id).status, 'pending')
})

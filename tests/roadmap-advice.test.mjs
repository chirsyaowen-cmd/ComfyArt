import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRoadmapAdvice, roadmapChangeForAdvice } from '../src/roadmapAdvice.ts'
import { KEEP_IMAGE_ONLY, reviseRoadmap } from '../src/roadmapModel.ts'

const frame = 'shape:page-2'
const step = { id: 'page-2-typography', title: '第 2 页排字', type: 'typography',
  scope: 'frames', targetFrameIds: [frame], status: 'pending' }
const plan = { goal: '', revision: 0, currentStepId: null, steps: [step], decisions: [] }
const suggestion = {
  text: '可以先完成第 2 页的图注，让读者知道拍摄地点。',
  options: [
    { label: '给第 2 页写图注', kind: 'request', stepId: step.id,
      request: '给第 2 页写一行图注，放在照片下方，先拟文案。' },
    { label: '保留第 2 页纯图片', kind: 'keep_image_only', stepId: step.id },
    { label: '关闭提醒', kind: 'dismiss' },
  ],
}

test('the reviewer can offer no next step or provide its own options without changing the roadmap', () => {
  const original = structuredClone(plan)
  assert.equal(parseRoadmapAdvice({ suggestion: null }, plan.steps), null)
  assert.deepEqual(parseRoadmapAdvice({ suggestion }, plan.steps), suggestion)
  assert.deepEqual(plan, original)
})

test('a request starts its chosen step and resumes it if previously deferred', () => {
  const [request] = parseRoadmapAdvice({ suggestion }, plan.steps).options
  for (const status of ['pending', 'deferred']) {
    const before = { ...plan, steps: [{ ...step, status }] }
    const change = roadmapChangeForAdvice(request, before.steps)
    const after = reviseRoadmap(before, [frame], [change], 'button')
    assert.equal(after.steps[0].status, 'in_progress')
    assert.equal(after.currentStepId, step.id)
    assert.equal(after.decisions[0].source, 'button')
    assert.equal(after.decisions[0].action, status === 'deferred' ? 'resume' : 'start')
  }
})

test('keeping pure images records the decision while dismissal makes no change', () => {
  const [, keep, dismiss] = parseRoadmapAdvice({ suggestion }, plan.steps).options
  assert.equal(roadmapChangeForAdvice(dismiss, plan.steps), null)
  const change = roadmapChangeForAdvice(keep, plan.steps)
  const after = reviseRoadmap(plan, [frame], [change], 'button')
  assert.equal(after.steps[0].status, 'deferred')
  assert.equal(after.decisions[0].action, KEEP_IMAGE_ONLY)
  assert.equal(after.decisions[0].reason, keep.label)
  assert.equal(after.decisions[0].stepId, step.id)
})

test('mismatched steps and unrecognized actions are rejected', () => {
  assert.throws(() => parseRoadmapAdvice({ issues: [] }, plan.steps))
  assert.throws(() => parseRoadmapAdvice({ suggestion: { text: '建议', options: [] } }, plan.steps))
  const withOption = option => ({ suggestion: { text: '建议', options: [option] } })
  assert.throws(() => parseRoadmapAdvice(withOption({ label: '执行', kind: 'update_canvas', stepId: step.id }), plan.steps))
  assert.throws(() => parseRoadmapAdvice(withOption({ ...suggestion.options[0], stepId: 'missing' }), plan.steps))
  assert.throws(() => parseRoadmapAdvice(withOption(suggestion.options[1]), [{ ...step, type: 'spread' }]))
})

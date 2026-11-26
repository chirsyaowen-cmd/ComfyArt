import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRoadmapAdvice } from '../src/roadmapAdvice.ts'

test('the reviewer can offer no next step for the same canvas', () => {
  assert.equal(parseRoadmapAdvice({ suggestion: null }), null)
  const suggestion = {
    text: '可以先完成第 2 页的图注，让读者知道拍摄地点。',
    options: [
      { label: '给第 2 页写图注', kind: 'request', request: '给第 2 页写一行图注，放在照片下方，先拟文案。' },
      { label: '这次先保留原样', kind: 'dismiss' },
    ],
  }
  assert.deepEqual(parseRoadmapAdvice({ suggestion }), suggestion)
})

test('an invalid response cannot supply a default option or an executable action', () => {
  assert.throws(() => parseRoadmapAdvice({ issues: [] }))
  assert.throws(() => parseRoadmapAdvice({ suggestion: { text: '建议', options: [] } }))
  assert.throws(() => parseRoadmapAdvice({ suggestion: {
    text: '建议', options: [{ label: '执行', kind: 'update_canvas' }],
  } }))
})

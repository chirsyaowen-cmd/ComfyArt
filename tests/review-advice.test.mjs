import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReviewAdvice } from '../src/reviewAdvice.ts'

test('review offers only the options chosen by the reviewer', () => {
  assert.equal(parseReviewAdvice({ suggestion: null }), null)
  const request = { label: 'Add a caption', kind: 'request', request: 'Caption page 2.' }
  const upload = { label: 'Choose photos', kind: 'upload_photos' }
  for (const options of [[request], [upload], [request, { label: 'Close', kind: 'dismiss' }]]) {
    const suggestion = { text: 'About page 2', options }
    assert.deepEqual(parseReviewAdvice({ suggestion }), suggestion)
  }
})

test('review rejects missing requests and unsupported actions', () => {
  for (const option of [{ kind: 'request' }, { kind: 'update_canvas' }]) {
    assert.throws(() => parseReviewAdvice({ suggestion: { text: 'Review', options: [{ label: 'Change', ...option }] } }))
  }
})

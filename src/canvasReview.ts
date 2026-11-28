import { atom, getHashForString, type Editor } from 'tldraw'

import { readLocal, writeLocal } from './localPrefs'
import { currentProject } from './notices'
import type { ReviewAdvice } from './reviewAdvice'
import { activeZineIndex, zineSpreads } from './zine'
import { inspectZine } from './zineReview'

export const guideShown = atom<{ noticeId: string; signature: string; advice: ReviewAdvice } | null>('latest canvas advice', null)

export function canvasReviewContext(editor: Editor) {
  const book = inspectZine(editor)
  if (!book) return null
  const page = activeZineIndex(editor)
  const frames = zineSpreads(book.pages.length).find(spread => spread.includes(page)) ?? [0]
  const targets = frames.map(index => book.pages[index])
  const shapes = Array.from(editor.getShapeAndDescendantIds(book.pages), id => editor.getShape(id))
  const bookVersion = getHashForString(JSON.stringify([book.pages, shapes]))
  return { book, page, targets, bookVersion, signature: page + '/' + bookVersion }
}

const manualReview = atom<string | null>('manual canvas review', null)
const manualKey = () => 'comfyart.manualReview.' + currentProject()

export function markManualReview(version: string) {
  writeLocal(manualKey(), version)
  manualReview.set(manualKey() + '/' + version)
  guideShown.set(null)
}

export function manuallyReviewed(version: string) {
  return manualReview.get() === manualKey() + '/' + version || readLocal(manualKey()) === version
}

export function currentReviewAdvice(editor: Editor) {
  const guide = guideShown.get()
  return guide && guide.signature === canvasReviewContext(editor)?.signature ? guide : null
}

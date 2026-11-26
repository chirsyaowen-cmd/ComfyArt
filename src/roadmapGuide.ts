import { atom, getHashForString, type Editor } from 'tldraw'

import { readLocal, writeLocal } from './localPrefs'
import { currentProject } from './notices'
import { roadmap } from './roadmap'
import type { RoadmapAdvice } from './roadmapAdvice'
import { activeZineIndex, zineSpreads } from './zine'
import { inspectZine } from './zineReview'

export const roadmapOpen = atom('show project roadmap', false)
export const guideShown = atom<{ noticeId: string; signature: string; advice: RoadmapAdvice } | null>('latest roadmap advice', null)

export function roadmapReviewContext(editor: Editor) {
  const book = inspectZine(editor)
  if (!book) return null
  const page = activeZineIndex(editor)
  const frames = zineSpreads(book.pages.length).find(spread => spread.includes(page)) ?? [0]
  const targets = frames.map(index => book.pages[index])
  const plan = roadmap(editor)
  const shapes = Array.from(editor.getShapeAndDescendantIds(book.pages), id => editor.getShape(id))
  const bookVersion = getHashForString(JSON.stringify([book.pages, plan, shapes]))
  return { book, page, targets, plan, bookVersion, signature: page + '/' + bookVersion }
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

export function currentRoadmapAdvice(editor: Editor) {
  const guide = guideShown.get()
  return guide && guide.signature === roadmapReviewContext(editor)?.signature ? guide : null
}

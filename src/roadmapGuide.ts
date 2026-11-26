import { atom, type Editor } from 'tldraw'

import { roadmap } from './roadmap'
import type { RoadmapAdvice } from './roadmapAdvice'
import { activeZineIndex, zineSpreads } from './zine'
import { inspectZine } from './zineReview'

export const roadmapOpen = atom('show project roadmap', false)
export const guideShown = atom<{ signature: string; advice: RoadmapAdvice } | null>('latest roadmap advice', null)

export function roadmapReviewContext(editor: Editor) {
  const book = inspectZine(editor)
  if (!book) return null
  const page = activeZineIndex(editor)
  const frames = zineSpreads(book.pages.length).find(spread => spread.includes(page)) ?? [0]
  const targets = frames.map(index => book.pages[index])
  const plan = roadmap(editor)
  const shapes = Array.from(editor.getShapeAndDescendantIds(book.pages), id => editor.getShape(id))
  return { book, page, targets, plan, signature: JSON.stringify([page, plan, shapes]) }
}

export function currentRoadmapAdvice(editor: Editor) {
  const guide = guideShown.get()
  return guide && guide.signature === roadmapReviewContext(editor)?.signature ? guide : null
}

import type { Editor, TLShapeId } from 'tldraw'

import { t } from './i18n'
import { getZinePages, zineSpreads } from './zine'

export function inspectZine(editor: Editor) {
  const pages = getZinePages(editor)
  const currentIds = editor.getCurrentPageShapeIds()
  if (!pages.some(id => currentIds.has(id))) return null
  const spreads = zineSpreads(pages.length)
  const occupied = pages.filter(id => editor.getSortedChildIdsForParent(id).length > 0)
  return { pages, spreads, occupied }
}

export type ZineReview = NonNullable<ReturnType<typeof inspectZine>>

export function describeZine(book: ZineReview) {
  const numbers = (ids: TLShapeId[]) => ids.map(id => book.pages.indexOf(id) + 1).join(', ')
  return t('zineReview.context', book.pages.length, book.spreads.map(s => s.map(i => i + 1).join('–')).join(' / '),
    numbers(book.occupied), book.occupied.map(id => `${book.pages.indexOf(id) + 1} = ${id}`).join(', '))
}

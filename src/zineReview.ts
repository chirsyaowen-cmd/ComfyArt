import type { Editor, TLImageShape, TLShapeId } from 'tldraw'

import { t } from './i18n'
import { getZinePages, zineSpreads } from './zine'

export function inspectZine(editor: Editor) {
  const pages = getZinePages(editor)
  const currentIds = editor.getCurrentPageShapeIds()
  if (!pages.some(id => currentIds.has(id))) return null
  const spreads = zineSpreads(pages.length)
  const occupied = pages.filter(id => editor.getSortedChildIdsForParent(id).length > 0)
  const occupiedSet = new Set(occupied)
  const reviewPages = spreads.filter(spread => spread.some(i => occupiedSet.has(pages[i])))
    .flatMap(spread => spread.map(i => pages[i])).filter(id => !!editor.getShape(id))
  const outsidePhotos = occupied.length ? [] : editor.getCurrentPageShapes()
    .filter((s): s is TLImageShape => s.type === 'image' && !!s.props.assetId)
  return { pages, spreads, occupied, reviewPages, outsidePhotos }
}

export type ZineReview = NonNullable<ReturnType<typeof inspectZine>>

export function emptyBookMessage(book: ZineReview) {
  return t(book.outsidePhotos.length ? 'zineReview.nearby' : 'zineReview.empty')
}

export function describeZine(book: ZineReview) {
  const numbers = (ids: TLShapeId[]) => ids.map(id => book.pages.indexOf(id) + 1).join(', ')
  return t('zineReview.context', book.pages.length, book.spreads.map(s => s.map(i => i + 1).join('–')).join(' / '),
    numbers(book.occupied), book.occupied.map(id => `${book.pages.indexOf(id) + 1} = ${id}`).join(', '))
}

import { atom, type Editor } from 'tldraw'
import { reviewStep } from './roadmapModel'
import { roadmap } from './roadmap'
import { projectPhotos } from './roadmapPhotos'
import { activeZineIndex, getZinePages, ZINE_PAPER_STYLE, zineSpreads } from './zine'
import { artboardStyle } from './shapes/ArtboardShape'
import { t } from './i18n'

export const roadmapOpen = atom('show project roadmap', false)
export const guideShown = atom<string | null>('latest automatic roadmap suggestion', null)

export function roadmapGuide(editor: Editor) {
  const plan = roadmap(editor)
  const pages = getZinePages(editor)
  const index = activeZineIndex(editor)
  const frame = pages[index]
  const spread = frame ? zineSpreads(pages.length)[Math.ceil(index / 2)].map(i => pages[i]) : []
  const art = Array.from(editor.getShapeAndDescendantIds(spread), id => editor.getShape(id))
  const hasBase = art.some(s => {
    if (s?.type === 'frame') {
      const fill = artboardStyle(s).fill
      return !!fill && fill !== ZINE_PAPER_STYLE.fill && fill !== 'transparent'
    }
    return s && !['comment', 'group', 'ca-text', 'text'].includes(s.type)
  })
  const step = reviewStep(plan, frame, hasBase)
  if (!step || step.status === 'done') return null
  const targets = step.scope === 'book' ? pages : step.targetFrameIds
  const content = targets.reduce((n, frame) => n + editor.getSortedChildIdsForParent(frame).length, 0)
  const lib = projectPhotos(editor)
  const batch = new Set(lib.batch)
  const photos = lib.photos.filter(p => p.state === 'ready' && batch.has(p.key))
  const text = step.status === 'deferred' ? t('road.suggestResume', step.title)
    : step.type === 'typography' ? t('road.requestText', targets.map(id => pages.indexOf(id) + 1).join('–'))
    : step.type === 'embellishment' ? t('road.requestEmbellishment')
    : step.type === 'photo_adjust' ? t('photo.review')
    : content ? t('road.hasContent', step.title, content)
    : photos.length && targets.length && step.scope === 'frames' ? t('road.suggestPhoto', step.title)
    : t('road.suggest', step.title)
  const textFrame = targets.includes(frame) ? frame : targets[0]
  return { step, targets, textFrame, content, photos, text, revision: plan.revision,
    signature: JSON.stringify([plan.revision, step.id, step.type === 'typography' ? textFrame : null, photos.map(p => p.key), !!content]) }
}

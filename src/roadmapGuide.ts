import { atom, type Editor } from 'tldraw'
import { nextStep } from './roadmapModel'
import { roadmap } from './roadmap'
import { projectPhotos } from './roadmapPhotos'
import { getZinePages } from './zine'
import { t } from './i18n'

export const roadmapOpen = atom('show project roadmap', false)
export const guideShown = atom<string | null>('latest automatic roadmap suggestion', null)

export function roadmapGuide(editor: Editor) {
  const plan = roadmap(editor)
  const step = plan.steps.find(s => s.id === plan.currentStepId) ?? nextStep(plan)
  if (!step || step.status === 'done') return null
  const targets = step.scope === 'book' ? getZinePages(editor) : step.targetFrameIds
  const content = targets.reduce((n, frame) => n + editor.getSortedChildIdsForParent(frame).length, 0)
  const lib = projectPhotos(editor)
  const batch = new Set(lib.batch)
  const photos = lib.photos.filter(p => p.state === 'ready' && batch.has(p.key))
  const text = step.status === 'deferred' ? t('road.suggestResume', step.title)
    : step.type === 'photo_adjust' ? t('photo.review')
    : content ? t('road.hasContent', step.title, content)
    : photos.length && targets.length && step.scope === 'frames' ? t('road.suggestPhoto', step.title)
    : t('road.suggest', step.title)
  return { step, targets, content, photos, text, revision: plan.revision,
    signature: JSON.stringify([plan.revision, step.id, photos.map(p => p.key), !!content]) }
}

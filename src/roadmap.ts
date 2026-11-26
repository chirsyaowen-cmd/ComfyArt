import { react, type Editor, type TLImageShape, type TLShapeId } from 'tldraw'
import { t } from './i18n'
import { activeZineIndex, getZinePages, zineSpreads } from './zine'
import { adjustedOf } from './imageOps'
import { uuid } from './id'

import { COVER_PHOTO_STEP, readCoverTypography, repeatsLastCompletion, reviseRoadmap, treatedCoverTypography, type Step, type Roadmap, type Source, type Change } from './roadmapModel'
import { textShapesOnPage } from './zineText'

export { COVER_PHOTO_STEP } from './roadmapModel'

export function coverPhoto(editor: Editor) {
  const page = getZinePages(editor)[0]
  if (!page) return undefined
  const photos = Array.from(editor.getShapeAndDescendantIds([page]), id => editor.getShape(id))
    .filter((s): s is TLImageShape => s?.type === 'image' && !!s.props.assetId)
  return photos.sort((a, b) => b.props.w * b.props.h - a.props.w * a.props.h)[0]
}

function syncCoverPhoto(editor: Editor, plan: Roadmap): Roadmap {
  const photo = coverPhoto(editor)
  const key = photo && photo.id + '/' + (adjustedOf(photo)?.source ?? photo.props.assetId)
  const prior = plan.steps.find(s => s.id === COVER_PHOTO_STEP)
  if (prior?.sourceSignature === key) return plan
  const steps = plan.steps.filter(s => s.id !== COVER_PHOTO_STEP)
  const cover = steps.findIndex(s => s.type === 'cover')
  if (cover < 0) return plan
  if (key) steps.splice(cover + 1, 0, { id: COVER_PHOTO_STEP, type: 'photo_adjust', title: t('photo.road'),
    sourceSignature: key, scope: 'frames', targetFrameIds: steps[cover].targetFrameIds, status: 'pending' })
  return { ...plan, steps, decisions: plan.decisions.filter(d => d.stepId !== COVER_PHOTO_STEP),
    currentStepId: !key && plan.currentStepId === COVER_PHOTO_STEP ? steps[cover].id : plan.currentStepId,
    revision: plan.revision + 1 }
}

function pageSteps(editor: Editor): Step[] {
  const pages = getZinePages(editor)
  const steps: Step[] = pages.length ? zineSpreads(pages.length).map((spread, i) => {
    const frames = spread.map(index => pages[index])
    const type = i === 0 ? 'cover' : frames.length === 1 ? 'back_cover' : 'spread'
    return { id: type === 'spread' ? 'spread-' + frames[0] : type, type,
      title: t('road.' + type, spread[0] + 1, spread[spread.length - 1] + 1),
      scope: 'frames', targetFrameIds: frames, status: 'pending' }
  }) : []
  return steps
}

// Install missing page stages in saved books as well as newly added spreads.
// Existing steps keep their order, decisions and status.
function syncPageStages(editor: Editor, plan: Roadmap) {
  const steps = [...plan.steps]
  for (const page of pageSteps(editor)) {
    let index = steps.findIndex(s => s.id === page.id)
    if (index < 0) {
      index = steps.findIndex(s => s.type === 'back_cover' || s.type === 'review')
      if (index < 0) index = steps.length
      steps.splice(index, 0, page)
    }
    if (steps[index + 1]?.type === 'photo_adjust') index++
    for (const type of ['typography', 'embellishment']) {
      const id = page.id + '-' + type
      const existing = steps.findIndex(s => s.id === id)
      if (existing >= 0) { index = existing; continue }
      steps.splice(++index, 0, { id, type, scope: 'frames', targetFrameIds: page.targetFrameIds,
        title: t('road.' + type, page.title), status: 'pending' })
    }
  }
  return steps.length === plan.steps.length ? plan : { ...plan, steps }
}

function defaultRoadmap(editor: Editor): Roadmap {
  const steps = pageSteps(editor)
  if (steps.length) steps.push({ id: 'review', type: 'review', title: t('road.review'), targetFrameIds: [], scope: 'book', status: 'pending' })
  return { goal: '', currentStepId: steps[0]?.id ?? null, steps, decisions: [], revision: 0 }
}

function savedRoadmap(editor: Editor): Roadmap {
  const saved = editor.getDocumentSettings().meta.roadmap
  return saved ? saved as Roadmap : defaultRoadmap(editor)
}

export function roadmap(editor: Editor): Roadmap {
  const plan = savedRoadmap(editor)
  const cover = treatedCoverTypography(plan)?.targetFrameIds[0]
  return cover ? readCoverTypography(plan, textShapesOnPage(editor, cover).length > 0) : plan
}

const previous = new WeakMap<Editor, { saved: Roadmap; revision: number }>()
export function assertRevision(editor: Editor, expected: unknown) {
  if (editor.getIsReadonly() || editor.isDisposed) throw new Error('Project editor is closed or read-only')
  if (roadmap(editor).revision !== expected) throw new Error('ROADMAP_CONFLICT: direction changed. Read get_canvas and reassess.')
}
function save(editor: Editor, plan: Roadmap) {
  editor.run(() => editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, roadmap: plan } }), { history: 'ignore' })
}
export function trackRoadmap(editor: Editor) {
  if (!getZinePages(editor).length) return () => {}
  if (!editor.getDocumentSettings().meta.roadmap) save(editor, defaultRoadmap(editor))
  return react('infer only the start of page design', () => {
    const plan = savedRoadmap(editor)
    const updated = syncPageStages(editor, syncCoverPhoto(editor, plan))
    const steps = updated.steps.map(step => {
      if (step.status !== 'pending' && !step.startedByCanvas) return step
      if (!['cover', 'back_cover', 'spread'].includes(step.type)) return step
      const occupied = step.targetFrameIds.some(id => editor.getSortedChildIdsForParent(id).length > 0)
      if (occupied && step.status === 'pending') return { ...step, status: 'in_progress' as const, startedByCanvas: true as const }
      if (!occupied && step.startedByCanvas) {
        const { startedByCanvas: _inferred, ...rest } = step
        return { ...rest, status: 'pending' as const }
      }
      return step
    })
    if (updated !== plan || steps.some((step, i) => step !== plan.steps[i])) {
      const prior = previous.get(editor)
      if (prior?.revision === plan.revision) prior.revision++
      save(editor, { ...updated, steps, revision: plan.revision + 1 })
    }
  })
}
export function updateRoadmap(editor: Editor, expected: number, changes: Change[], source: Source) {
  const original = savedRoadmap(editor)
  if (repeatsLastCompletion(original, expected, changes)) return roadmap(editor)
  assertRevision(editor, expected)
  const frames = getZinePages(editor).filter(id => editor.getShape(id)?.type === 'frame')
  if (!frames.length) throw new Error('Expected a Zine project')
  const cover = treatedCoverTypography(original)
  const commands = cover?.status === 'deferred' && treatedCoverTypography(roadmap(editor))?.status === 'pending'
    ? changes.map(change => change.id === cover.id && change.action === 'start' ? { ...change, action: 'resume' } : change)
    : changes
  const plan = reviseRoadmap(original, frames, commands, source)
  if (plan === original) return roadmap(editor)
  previous.set(editor, { saved: original, revision: plan.revision })
  save(editor, plan)
  return roadmap(editor)
}
export function canUndoRoadmap(editor: Editor) { return previous.get(editor)?.revision === roadmap(editor).revision }
export function undoRoadmap(editor: Editor) {
  const prior = previous.get(editor)
  if (!prior) return
  assertRevision(editor, prior.revision)
  previous.delete(editor)
  save(editor, { ...prior.saved, revision: prior.revision + 1 })
}

// A new user request supersedes earlier work even before it changes the roadmap.
export type RoadmapTurn = { token: string; revision: number; source: Source; frame: TLShapeId; inspected: boolean
  viewedFrames: Map<TLShapeId, string>; placedText: Set<TLShapeId> }
const turns = new WeakMap<Editor, RoadmapTurn>()
export function matchingRoadmapTurn(editor: Editor, token?: string) {
  const turn = turns.get(editor)
  return turn?.token === token ? turn : undefined
}
export function beginRoadmapTurn(editor: Editor, source: Source) {
  const pages = getZinePages(editor)
  if (!pages.length) return undefined
  const turn: RoadmapTurn = { token: uuid(), revision: roadmap(editor).revision, source,
    frame: pages[activeZineIndex(editor)], inspected: false, viewedFrames: new Map(), placedText: new Set() }
  turns.set(editor, turn)
  return turn.token
}
export const roadmapSource = (editor: Editor) => turns.get(editor)?.source ?? 'chat'
export const currentRoadmapTurn = (editor: Editor) => turns.get(editor)?.token
export function checkRoadmapTurn(editor: Editor, token: string) {
  const active = turns.get(editor)
  if (!active || active.token !== token) throw new Error('TASK_SUPERSEDED: a newer request or editor session took over')
  assertRevision(editor, active.revision)
  return active
}

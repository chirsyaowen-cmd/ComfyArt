import { react, type Editor } from 'tldraw'
import { t } from './i18n'
import { getZinePages, zineSpreads } from './zine'
import { uuid } from './id'

import { reviseRoadmap, type Step, type Roadmap, type Source, type Change } from './roadmapModel'

function defaultRoadmap(editor: Editor): Roadmap {
  const pages = getZinePages(editor)
  const steps: Step[] = pages.length ? zineSpreads(pages.length).map((spread, i) => {
    const frames = spread.map(index => pages[index])
    const type = i === 0 ? 'cover' : frames.length === 1 ? 'back_cover' : 'spread'
    return { id: type === 'spread' ? 'spread-' + frames[0] : type, type,
      title: t('road.' + type, spread[0] + 1, spread[spread.length - 1] + 1),
      scope: 'frames', targetFrameIds: frames, status: 'pending' }
  }) : []
  if (steps.length) steps.push({ id: 'review', type: 'review', title: t('road.review'), targetFrameIds: [], scope: 'book', status: 'pending' })
  return { goal: '', currentStepId: steps[0]?.id ?? null, steps, decisions: [], revision: 0 }
}

export function roadmap(editor: Editor): Roadmap {
  const saved = editor.getDocumentSettings().meta.roadmap
  return saved ? saved as Roadmap : defaultRoadmap(editor)
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
    const plan = roadmap(editor)
    const steps = plan.steps.map(step => {
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
    if (steps.some((step, i) => step !== plan.steps[i])) {
      const prior = previous.get(editor)
      if (prior?.revision === plan.revision) prior.revision++
      save(editor, { ...plan, steps, revision: plan.revision + 1 })
    }
  })
}
export function updateRoadmap(editor: Editor, expected: number, changes: Change[], source: Source) {
  assertRevision(editor, expected)
  const frames = getZinePages(editor).filter(id => editor.getShape(id)?.type === 'frame')
  if (!frames.length) throw new Error('Expected a Zine project')
  const original = roadmap(editor)
  const plan = reviseRoadmap(original, frames, changes, source)
  if (plan === original) return plan
  previous.set(editor, { saved: original, revision: plan.revision })
  save(editor, plan)
  return plan
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
const turns = new WeakMap<Editor, { token: string; revision: number; source: Source }>()
export function beginRoadmapTurn(editor: Editor, source: Source) {
  if (!getZinePages(editor).length) return undefined
  const turn = { token: uuid(), revision: roadmap(editor).revision, source }
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

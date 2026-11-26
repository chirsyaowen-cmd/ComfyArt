import { useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { applies } from '../roadmapModel'
import { canUndoRoadmap, roadmap, undoRoadmap, updateRoadmap } from '../roadmap'
import { roadmapGuide, roadmapOpen } from '../roadmapGuide'
import { activeZineIndex, getZinePages } from '../zine'
import { embellishmentPageStatus, makeEmbellishmentOffer, type EmbellishmentOffer } from '../zineEmbellishments'
import { Modal } from './Modal'
import { ZineEmbellishmentCard } from './ZineEmbellishmentCard'

function EmbellishmentPage({ editor, id, label }: { editor: Editor; id: TLShapeId; label?: string }) {
  const state = useValue('page embellishments', () => ({
    status: embellishmentPageStatus(editor, id),
    offer: makeEmbellishmentOffer(editor, id, true),
  }), [editor, id])
  const [offer, setOffer] = useState<EmbellishmentOffer>()
  if (!state.status && !state.offer && !offer) return null
  return <div>
    <div className="ca-zine-photo__actions">
      {label && <span>{label}</span>}
      {state.status && <span>{t(`embellishment.${state.status}`)}</span>}
      {state.offer && <button type="button" onClick={() => setOffer(state.offer)}>{t('embellishment.open')}</button>}
    </div>
    {offer && <ZineEmbellishmentCard key={offer.version} editor={editor} initial={offer} />}
  </div>
}

export function RoadmapDialog({ editor }: { editor: Editor }) {
  const plan = useValue('project roadmap', () => roadmap(editor), [editor])
  const suggested = useValue('typography review suggestion', () => {
    const step = roadmapGuide(editor)?.step
    return step?.type === 'typography' && step.status === 'pending' ? step.id : null
  }, [editor])
  const undo = useValue('undo roadmap', () => canUndoRoadmap(editor), [editor])
  const [filter, setFilter] = useState(false)
  const [error, setError] = useState('')
  const frame = useValue('roadmap page filter', () => getZinePages(editor)[activeZineIndex(editor)], [editor])
  const pages = useValue('roadmap page order', () => getZinePages(editor), [editor])
  const change = (action: string, id: string, before?: string) => {
    try { updateRoadmap(editor, plan.revision, [{ action, id, before }], 'button'); setError('') }
    catch (e) { setError(errorText(e)) }
  }
  return <Modal title={t('road.title')} className="ca-roadmap" onClose={() => roadmapOpen.set(false)}>
    {plan.goal && <p>{plan.goal}</p>}
    <label><input type="checkbox" checked={filter} onChange={e => setFilter(e.target.checked)} /> {t('road.onlyPage')}</label>
    <ol>{plan.steps.filter(s => !filter || applies(s, frame)).map(s => {
      const i = plan.steps.indexOf(s)
      const decision = [...plan.decisions].reverse().find(d => d.stepId === s.id)
      if (s.type === 'embellishment') return <li key={s.id}>
        <strong>{s.title}</strong>
        {s.targetFrameIds.filter(id => !filter || id === frame).map(id => <EmbellishmentPage editor={editor} id={id} key={id}
          label={s.targetFrameIds.length > 1 ? t('road.page', pages.indexOf(id) + 1) : undefined} />)}
      </li>
      return <li key={s.id} aria-current={plan.currentStepId === s.id ? 'step' : undefined}>
        <strong>{s.title}</strong> · {t('road.' + s.status)}
        {plan.currentStepId === s.id && <small> · {t('road.current')}</small>}
        {suggested === s.id && <small> · {t('road.reviewSuggestion')}</small>}
        {decision?.reason && <div>{decision.reason}</div>}
        <div className="ca-zine-photo__actions">
          {s.status === 'deferred'
            ? <button onClick={() => change('resume', s.id)}>{t('road.resume')}</button>
            : <>
              {(s.status !== 'in_progress' || plan.currentStepId !== s.id) && <button onClick={() => change('start', s.id)}>{t('road.start')}</button>}
              {s.status !== 'done' && <button onClick={() => change('defer', s.id)}>{t('road.skip')}</button>}
              {s.status !== 'done' && <button onClick={() => change('done', s.id)}>{t('road.finish')}</button>}
            </>}
          {i > 0 && <button aria-label={t('road.up') + ' ' + s.title} onClick={() => change('move', s.id, plan.steps[i - 1].id)}>{t('road.up')}</button>}
        </div>
      </li>
    })}</ol>
    {undo && <button className="ca-panel__chip" onClick={() => undoRoadmap(editor)}>{t('road.undo')}</button>}
    {error && <div role="alert">{error}</div>}
  </Modal>
}

import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { sendToAgent } from '../agent'
import { thumbUrl, viewUrl } from '../comfy'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { updateRoadmap } from '../roadmap'
import { KEEP_IMAGE_ONLY, onRequest } from '../roadmapModel'
import { roadmapGuide, roadmapOpen } from '../roadmapGuide'
import { frameFacts, placeProjectPhoto } from '../roadmapPhotos'
import { focusZinePage, getZinePages } from '../zine'
import { importFiles } from './DropHandlers'

export function ZinePhotoPrompt({ editor, actionsOnly = false }: { editor: Editor; actionsOnly?: boolean }) {
  const guide = useValue('current roadmap guidance', () => roadmapGuide(editor), [editor])
  const [sendingText, setSendingText] = useState(false)
  const [picker, setPicker] = useState(false)
  const [choosingPhoto, setChoosingPhoto] = useState(false)
  const [page, setPage] = useState('')
  const [error, setError] = useState('')
  if (!guide) return <button className="ca-panel__chip" onClick={() => roadmapOpen.set(true)}>{t('road.title')}</button>
  const { step, targets, textFrame, photos, revision } = guide
  const target = targets.find(id => id === page) ?? targets[0]
  const pick = !onRequest(step) && step.type !== 'photo_adjust' && step.scope === 'frames' && target && step.status !== 'deferred'
  const pages = getZinePages(editor)
  const startText = async (request: string) => {
    setError('')
    setSendingText(true)
    try {
      if (roadmapGuide(editor)?.signature !== guide.signature) return
      focusZinePage(editor, pages.indexOf(textFrame))
      updateRoadmap(editor, revision, [{ action: 'start', id: step.id }], 'button')
      await sendToAgent(editor, request, [], null)
    } catch (e) { setError(errorText(e)) }
    finally { setSendingText(false) }
  }
  const choose = async (key: string) => {
    const version = frameFacts(editor, target).frame_version
    await placeProjectPhoto(editor, { frame: target, expected_revision: revision, frame_version: version, photo_key: key, fit: 'cover' }, () => {})
    setPicker(false)
  }
  return <div className="ca-zine-photo" onClick={e => e.stopPropagation()}>
    {!actionsOnly && <div>{guide.text}</div>}
    <div className="ca-zine-photo__actions">
      {step.status === 'deferred' && <button onClick={() => updateRoadmap(editor, revision, [{ action: 'resume', id: step.id }], 'button')}>{t('road.resume')}</button>}
      {step.type === 'photo_adjust' && step.status !== 'deferred' && <button onClick={() => void sendToAgent(editor, t('photo.review'), [], null).catch(e => setError(errorText(e)))}>{t('photo.review')}</button>}
      {step.type === 'typography' && step.status !== 'deferred' && textFrame && <>
        {['road.addTitle', 'road.addCaption'].map(key =>
          <button key={key} disabled={sendingText} onClick={() => void startText(t(key))}>{t(key)}</button>)}
        <button disabled={sendingText} onClick={() => {
          try {
            if (roadmapGuide(editor)?.signature !== guide.signature) return
            updateRoadmap(editor, revision, [{ action: KEEP_IMAGE_ONLY, id: step.id, reason: t('road.imageOnly') }], 'button')
          }
          catch (e) { setError(errorText(e)) }
        }}>{t('road.imageOnly')}</button>
      </>}
      {pick && !photos.length && <button onClick={() => importFiles(editor, 'image/*')}>{t('zineReview.upload')}</button>}
      {pick && !!photos.length && !choosingPhoto && <button onClick={() => setChoosingPhoto(true)}>{t('road.place')}</button>}
      {pick && !!photos.length && choosingPhoto && <>
        <button onClick={() => setPicker(!picker)}>{t('road.pick')}</button>
        <button onClick={() => void sendToAgent(editor, t('road.helpPick', step.title), [], null).catch(e => setError(errorText(e)))}>{t('road.help')}</button>
      </>}
      <button onClick={() => roadmapOpen.set(true)}>{t('road.title')}</button>
    </div>
    {pick && picker && <div>
      <label>{t('road.target')} <select value={target} onChange={e => setPage(e.target.value)}>
        {targets.map(id => <option key={id} value={id}>{t('road.page', pages.indexOf(id) + 1)}</option>)}
      </select></label>
      <p>{t('road.pickFill')}</p>
      <div className="ca-assets__grid">{photos.map(photo => <button className="ca-side__cell" key={photo.key} title={photo.name}
        onClick={() => { setError(''); void choose(photo.key).catch(e => setError(errorText(e))) }}>
        <img alt={photo.name} src={thumbUrl(viewUrl(photo.ref))} loading="lazy" />
      </button>)}</div>
    </div>}
    {error && <div role="alert">{error}</div>}
  </div>
}

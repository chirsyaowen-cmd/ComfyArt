import { useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'

import { placeAsset } from '../assets'
import { busy } from '../bot'
import { sendToAgent } from '../agent'
import { thumbUrl, viewUrl } from '../comfy'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { currentRoadmapAdvice, guideShown, roadmapOpen } from '../roadmapGuide'
import { projectPhotos } from '../roadmapPhotos'
import { getZinePages } from '../zine'
import { importFiles } from './DropHandlers'

export function EmptyBookPhotos({ editor, frame, onError, onRequest }: {
  editor: Editor; frame: TLShapeId; onError: (error: string) => void; onRequest: () => void
}) {
  const photos = useValue('available project photos', () => projectPhotos(editor).photos.filter(p => p.state === 'ready'), [editor])
  const working = useValue('agent running', busy, [])
  const [picker, setPicker] = useState(false)
  const help = () => {
    const page = getZinePages(editor).indexOf(frame) + 1
    void sendToAgent(editor, t('zineReview.helpPhoto', page), [], null).then(onRequest).catch(e => onError(errorText(e)))
  }
  return <div className="ca-zine-photo">
    <div>{t('zineReview.blankBook')}</div>
    <div className="ca-zine-photo__actions">
      <button type="button" onClick={() => importFiles(editor, 'image/*')}>{t('zineReview.devicePhotos')}</button>
      {!!photos.length && <>
        <button type="button" aria-expanded={picker} onClick={() => setPicker(!picker)}>{t('zineReview.projectPhotos')}</button>
        <button type="button" disabled={working} onClick={help}>{t('road.help')}</button>
      </>}
    </div>
    {picker && <div className="ca-assets__grid">{photos.map(photo =>
      <button type="button" key={photo.key} title={photo.name} className="ca-side__cell" onClick={() =>
        void placeAsset(editor, { kind: 'image', name: photo.name, src: viewUrl(photo.ref) }, frame).catch(e => onError(errorText(e)))}>
        <img alt={photo.name} src={thumbUrl(viewUrl(photo.ref))} loading="lazy" />
      </button>)}</div>}
  </div>
}

export function ZinePhotoPrompt({ editor, noticeText }: { editor: Editor; noticeText?: string }) {
  const guide = useValue('current roadmap advice', () => currentRoadmapAdvice(editor), [editor])
  const working = useValue('agent running', busy, [])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  if (!guide || (noticeText !== undefined && noticeText !== guide.advice.text)) return null

  const choose = async (option: (typeof guide.advice.options)[number]) => {
    if (sending || busy() || guide !== currentRoadmapAdvice(editor)) return
    if (option.kind === 'dismiss') {
      guideShown.set(null)
      return
    }
    setError('')
    setSending(true)
    try {
      await sendToAgent(editor, option.request, [], null)
      if (guideShown.get() === guide) guideShown.set(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false)
    }
  }

  return <div className="ca-zine-photo" onClick={e => e.stopPropagation()}>
    {noticeText === undefined && <div>{guide.advice.text}</div>}
    <div className="ca-zine-photo__actions">
      {guide.advice.options.map((option, index) =>
        <button type="button" key={index} disabled={sending || working}
          title={option.kind === 'request' ? option.request : undefined}
          onClick={() => void choose(option)}>{option.label}</button>)}
      {noticeText === undefined && <button type="button" onClick={() => roadmapOpen.set(true)}>{t('road.title')}</button>}
    </div>
    {error && <div role="alert">{error}</div>}
  </div>
}

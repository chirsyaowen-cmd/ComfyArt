import { useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'

import { placeAsset } from '../assets'
import { busy, type BotBlock } from '../bot'
import { sendToAgent } from '../agent'
import { thumbUrl, viewUrl } from '../comfy'
import { t } from '../i18n'
import { errorText, type ErrorSink } from '../jobs'
import { roadmap, updateRoadmap } from '../roadmap'
import { roadmapChangeForAdvice, type AdviceOption } from '../roadmapAdvice'
import { currentRoadmapAdvice, guideShown, roadmapOpen, roadmapReviewContext } from '../roadmapGuide'
import { readLocal, writeLocal } from '../localPrefs'
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
  if (!photos.length) return null
  return <div className="ca-zine-photo">
    <div className="ca-zine-photo__actions">
      <button type="button" aria-expanded={picker} onClick={() => setPicker(!picker)}>{t('zineReview.projectPhotos')}</button>
      <button type="button" disabled={working} onClick={help}>{t('road.help')}</button>
    </div>
    {picker && <div className="ca-assets__grid">{photos.map(photo =>
      <button type="button" key={photo.key} title={photo.name} className="ca-side__cell" onClick={() =>
        void placeAsset(editor, { kind: 'image', name: photo.name, src: viewUrl(photo.ref) }, frame).catch(e => onError(errorText(e)))}>
        <img alt={photo.name} src={thumbUrl(viewUrl(photo.ref))} loading="lazy" />
      </button>)}</div>}
  </div>
}

export function ZinePhotoPrompt({ editor, onError, noticeText }: { editor: Editor; onError: ErrorSink; noticeText?: string }) {
  const guide = useValue('current roadmap advice', () => currentRoadmapAdvice(editor), [editor])
  if (!guide || (noticeText !== undefined && noticeText !== guide.advice.text)) return null
  return <ReviewOptions editor={editor} advice={guide.advice} onError={onError} showText={noticeText === undefined}
    valid={() => guide === currentRoadmapAdvice(editor)} close={() => {
      if (guideShown.get() === guide) guideShown.set(null)
    }} />
}

export function ManualReviewOptions({ editor, review, messageId, streaming, onError }: {
  editor: Editor; review: NonNullable<BotBlock['review']>; messageId: string; streaming: boolean; onError: ErrorSink
}) {
  const key = 'comfyart.reviewChoice.' + messageId
  const [closed, setClosed] = useState(() => !!readLocal(key))
  const valid = () => roadmapReviewContext(editor)?.bookVersion === review.bookVersion
  const current = useValue('review still current', valid, [editor, review])
  if (closed || !current) return <div>{review.advice.text}</div>
  return <ReviewOptions editor={editor} advice={review.advice} onError={onError} showText allowBusy={streaming}
    valid={valid} close={() => { writeLocal(key, '1'); setClosed(true) }} />
}

function ReviewOptions({ editor, advice, onError, valid, close, showText, allowBusy = false }: {
  editor: Editor; advice: NonNullable<BotBlock['review']>['advice']; onError: ErrorSink
  valid: () => boolean; close: () => void; showText: boolean; allowBusy?: boolean
}) {
  const working = useValue('agent running', busy, [])
  const [sending, setSending] = useState(false)

  const choose = async (option: AdviceOption) => {
    if (sending || (busy() && !allowBusy) || !valid()) return
    if (option.kind === 'upload_photos') {
      importFiles(editor, 'image/*', close)
      return
    }
    setSending(true)
    try {
      const plan = roadmap(editor)
      const change = roadmapChangeForAdvice(option, plan.steps)
      if (change) updateRoadmap(editor, plan.revision, [change], 'button')
      if (option.kind === 'request') await sendToAgent(editor, option.request, [], null)
      close()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setSending(false)
    }
  }

  return <div className="ca-zine-photo" onClick={e => e.stopPropagation()}>
    {showText && <div>{advice.text}</div>}
    <div className="ca-zine-photo__actions">
      {advice.options.map((option, index) =>
        <button type="button" key={index} disabled={sending || (working && !allowBusy)}
          title={option.kind === 'request' ? option.request : undefined}
          onClick={() => void choose(option)}>{option.label}</button>)}
      {showText && <button type="button" onClick={() => roadmapOpen.set(true)}>{t('road.title')}</button>}
    </div>
  </div>
}

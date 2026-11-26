import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { busy, type BotBlock } from '../bot'
import { sendToAgent } from '../agent'
import { errorText, type ErrorSink } from '../jobs'
import { roadmap, updateRoadmap } from '../roadmap'
import { roadmapChangeForAdvice, type AdviceOption } from '../roadmapAdvice'
import { currentRoadmapAdvice, guideShown, roadmapReviewContext } from '../roadmapGuide'
import { readLocal, writeLocal } from '../localPrefs'
import { importFiles } from './DropHandlers'

export function NoticeReviewOptions({ editor, onError, noticeId }: { editor: Editor; onError: ErrorSink; noticeId: string }) {
  const guide = useValue('current roadmap advice', () => currentRoadmapAdvice(editor), [editor])
  if (!guide || noticeId !== guide.noticeId) return null
  return <ReviewOptions editor={editor} advice={guide.advice} onError={onError} showText={false}
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
    </div>
  </div>
}

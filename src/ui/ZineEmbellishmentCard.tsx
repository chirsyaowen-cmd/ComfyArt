import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { sendToAgent } from '../agent'
import { busy } from '../bot'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { focusZinePage, getZinePages } from '../zine'
import { canRequestEmbellishments, decideEmbellishments, embellishmentOfferStatus, type EmbellishmentOffer } from '../zineEmbellishments'

export function RequestEmbellishments({ editor, frame, refresh, onSent }: { editor: Editor; frame: string; refresh?: boolean; onSent?: () => void }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const available = useValue('can request embellishments', () => canRequestEmbellishments(editor, frame), [editor, frame])
  const working = useValue('agent running', busy, [])
  if (!available) return null
  async function request() {
    const page = getZinePages(editor).findIndex(id => id === frame)
    if (page < 0 || busy()) return
    setSending(true)
    setError('')
    try {
      focusZinePage(editor, page)
      await sendToAgent(editor, t('embellishment.review'), [], null)
      onSent?.()
    } catch (e) { setError(errorText(e)) }
    finally { setSending(false) }
  }
  return <><button type="button" disabled={sending || working} onClick={request}>
    {t(refresh ? 'embellishment.refresh' : 'embellishment.open')}
  </button>{error && <span role="alert">{error}</span>}</>
}

export function ZineEmbellishmentCard({ editor, initial: offer }: { editor: Editor; initial: EmbellishmentOffer }) {
  const [error, setError] = useState('')
  const status = useValue('page preview status', () => embellishmentOfferStatus(editor, offer), [editor, offer])
  const decide = (action: 'apply' | 'skip') => {
    try { decideEmbellishments(editor, offer, action); setError('') }
    catch (e) { setError(errorText(e)) }
  }
  return <div className="ca-ask">
    {offer.preview && <><img style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} src={offer.preview} alt={t('embellishment.title')} /><p>{offer.reason}</p></>}
    {status === 'open' && <div className="ca-panel__foot">
      <button className="ca-panel__primary" onClick={() => decide('apply')}>{t('embellishment.add')}</button>
      <button className="ca-panel__chip" onClick={() => decide('skip')}>{t('embellishment.skip')}</button>
    </div>}
    {status !== 'open' && <div role="status">{t('embellishment.' + status)}</div>}
    {status === 'stale' && <RequestEmbellishments editor={editor} frame={offer.frame} refresh />}
    {error && <div role="alert">{error}</div>}
  </div>
}

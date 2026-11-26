import { useState } from 'react'
import { useValue, type Editor } from 'tldraw'

import { t } from '../i18n'
import { errorText } from '../jobs'
import { getZinePages } from '../zine'
import { decideEmbellishments, embellishmentOfferStatus, makeEmbellishmentOffer, type EmbellishmentOffer } from '../zineEmbellishments'

export function ZineEmbellishmentCard({ editor, initial }: { editor: Editor; initial: EmbellishmentOffer }) {
  const [offer, setOffer] = useState(initial)
  const [selected, setSelected] = useState<EmbellishmentOffer['options']>([])
  const [error, setError] = useState('')
  const status = useValue('embellishment offer status', () => embellishmentOfferStatus(editor, offer), [editor, offer])
  const page = useValue('embellishment page number', () => getZinePages(editor).findIndex(id => id === offer.frame), [editor, offer.frame])
  const label = page === 0 ? t('embellishment.cover') : page > 0 ? t('road.page', page + 1) : ''

  const refresh = () => {
    const fresh = makeEmbellishmentOffer(editor, offer.frame, true)
    if (!fresh) return setError(t('embellishment.unavailable'))
    setError('')
    setSelected([])
    setOffer(fresh)
  }
  const decide = (selection: EmbellishmentOffer['options'] | 'skip') => {
    try { decideEmbellishments(editor, offer, selection); setError('') }
    catch (e) { setError(errorText(e)) }
  }

  return <div className="ca-ask">
    <div className="ca-ask__title">{label ? t('embellishment.prompt', label) : t('embellishment.unavailable')}</div>
    {status === 'open' && <>
      <div className="ca-panel__chips">
        {offer.options.map(id => <button key={id} type="button" className="ca-panel__chip" aria-pressed={selected.includes(id)}
          data-on={selected.includes(id) || undefined} onClick={() => setSelected(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])}>
          {t(`embellishment.${id}`)}
        </button>)}
      </div>
      <div className="ca-panel__foot">
        <button type="button" className="ca-panel__primary" disabled={!selected.length} onClick={() => decide(selected)}>{t('embellishment.add')}</button>
        <button type="button" className="ca-panel__chip" onClick={() => decide('skip')}>{t('embellishment.skip')}</button>
      </div>
    </>}
    {status === 'stale' && label && <>
      <div className="ca-chat__hint">{t('embellishment.stale')}</div>
      <button type="button" className="ca-panel__chip" onClick={refresh}>{t('embellishment.refresh')}</button>
    </>}
    {(status === 'applied' || status === 'skipped') && <div className="ca-chat__hint" role="status">{t(`embellishment.${status}`)}</div>}
    {error && <div role="alert" className="ca-chat__hint">{error}</div>}
  </div>
}

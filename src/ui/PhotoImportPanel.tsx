import { useValue, type Editor } from 'tldraw'

import { photoDragProps, placeAsset } from '../assets'
import { viewUrl, thumbUrl } from '../comfy'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { photoImportAtom, retryPhoto } from '../photoImport'
import { getZinePages, activeZineIndex } from '../zine'

export function PhotoImportPanel({ editor, onError }: { editor: Editor; onError: (msg: string) => void }) {
  const rows = useValue(photoImportAtom)
  const stored = rows.filter(row => row.stage.kind === 'stored')
  const ready = rows.filter(row => row.stage.kind === 'stored' && row.stage.photo.state === 'ready')
  const page = useValue('photo destination', () => getZinePages(editor).length ? activeZineIndex(editor) + 1 : 0, [editor])
  return <div className="ca-photo-import">
    <div role="status">{t('photoImport.progress', stored.length, rows.length, ready.length)}</div>
    {rows.some(row => row.stage.kind === 'missing') && <p>{t('photoImport.reselect')}</p>}
    {rows.map(row => {
      const failed = row.stage.kind === 'stored' && row.stage.photo.state === 'failed'
      if (row.stage.kind !== 'error' && !failed) return null
      return <div key={row.id}>{row.name} · {row.stage.kind === 'error' ? row.stage.message : t('photoImport.decodeError')}
        {' '}<button className="ca-panel__chip" onClick={() => void retryPhoto(row).catch(e => onError(errorText(e)))}>{t('photoImport.retry')}</button></div>
    })}
    {!!ready.length && <p>{page ? t('photoImport.destination', page) : t('photoImport.canvas')}</p>}
    <div className="ca-assets__grid">{ready.map(row => {
      if (row.stage.kind !== 'stored') return null
      const src = viewUrl(row.stage.photo.ref)
      return <button key={row.id} title={row.name} className="ca-side__cell" {...photoDragProps(src, row.name)} onClick={() =>
        void placeAsset(editor, { src, name: row.name, kind: 'image' }, getZinePages(editor)[activeZineIndex(editor)]).catch(e => onError(errorText(e)))}>
        <img draggable={false} src={thumbUrl(src)} loading="lazy" decoding="async" alt="" />
      </button>
    })}</div>
  </div>
}

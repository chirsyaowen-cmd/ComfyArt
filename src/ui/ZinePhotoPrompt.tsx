import { useState } from 'react'
import { createShapeId, useValue, type Editor, type TLFrameShape, type TLImageShape } from 'tldraw'

import { placeAsset } from '../assets'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { activeZineIndex } from '../zine'
import { emptyBookMessage, inspectZine } from '../zineReview'
import { AssetGrid } from './AssetPicker'
import { importFiles } from './DropHandlers'
import { Popover } from './Popover'

export function ZinePhotoPrompt({ editor, actionsOnly = false }: { editor: Editor; actionsOnly?: boolean }) {
  const book = useValue('empty book for photos', () => inspectZine(editor), [editor])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  if (!book || book.occupied.length) return null

  const target = () => book.pages[activeZineIndex(editor)]
  function copyPhoto(photo: TLImageShape) {
    const page = editor.getShape<TLFrameShape>(target())
    if (!page || !photo.props.assetId) return
    const scale = Math.min(1, page.props.w / photo.props.w, page.props.h / photo.props.h)
    const w = photo.props.w * scale, h = photo.props.h * scale
    const id = createShapeId()
    editor.markHistoryStoppingPoint('place photo in zine')
    editor.createShape<TLImageShape>({ id, parentId: page.id, type: 'image',
      props: { ...photo.props, w, h }, x: (page.props.w - w) / 2, y: (page.props.h - h) / 2 })
    editor.select(id)
  }

  return <div className="ca-zine-photo" onClick={e => e.stopPropagation()}>
    {!actionsOnly && <div>{emptyBookMessage(book)}</div>}
    <div className="ca-zine-photo__actions">
      {book.outsidePhotos.map((photo, i) => <button key={photo.id} className="ca-panel__chip"
        onClick={() => copyPhoto(photo)}>{book.outsidePhotos.length === 1 ? t('zineReview.usePhoto') : t('zineReview.useNumbered', i + 1)}</button>)}
      <button className="ca-panel__chip" onClick={() => importFiles(editor, 'image/*')}>{t('zineReview.upload')}</button>
      <Popover open={open} onOpenChange={setOpen} side="top" trigger={({ toggle }) =>
        <button className="ca-panel__chip" onClick={toggle}>{t('zineReview.pick')}</button>}>
        <div className="ca-menu ca-assets-pop"><AssetGrid only="image" initialTab="input" onPick={item => {
          setOpen(false)
          setError('')
          void placeAsset(editor, item, target()).catch(e => setError(errorText(e)))
        }} /></div>
      </Popover>
    </div>
    {error && <div role="alert">{error}</div>}
  </div>
}

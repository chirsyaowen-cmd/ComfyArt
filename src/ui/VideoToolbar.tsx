import { useLayoutEffect, useRef, useState } from 'react'
import { useEditor, type TLVideoShape } from 'tldraw'

import { Icons } from './icons'
import { useOnlySelected, useSelectionRect } from './selection'
import { t } from '../i18n'

const GAP = 22
const EDGE = 8

export function VideoToolbar() {
  const editor = useEditor()
  const shape = useOnlySelected<TLVideoShape>('video')
  const rect = useSelectionRect()
  const bar = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    if (bar.current) setWidth(bar.current.offsetWidth)
  })

  if (!shape || !rect) return null
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  if (asset?.type !== 'video' || !asset.props.src) return null
  const { src, name } = asset.props

  const host = editor.getContainer().getBoundingClientRect()
  const left = Math.min(Math.max((rect.l + rect.r) / 2 - width / 2, EDGE), host.width - width - EDGE)
  let top = rect.t - GAP - 44
  if (top < EDGE) top = rect.b + GAP

  return (
    <div ref={bar} className="ca-bar ca-toolbar" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <a className="ca-bar__btn" href={src} download={name} title={t('common.download')}>
        <span className="ca-icon">{Icons.download}</span>
      </a>
    </div>
  )
}

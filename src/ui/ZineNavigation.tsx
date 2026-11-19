import { useEffect } from 'react'
import { useEditor, useValue, type TLEventInfo } from 'tldraw'

import { createPortal } from 'react-dom'
import { lang, t } from '../i18n'
import { activeZineIndex, focusZinePage, getZinePages, selectZinePage } from '../zine'
import { openBookPreview } from './Slideshow'
import { Icons } from './icons'
import '../styles/zine.css'

export function ZineNavigation() {
  const editor = useEditor()
  const active = useValue('active book page', () => activeZineIndex(editor), [editor])
  const pages = useValue('zine pages', () => getZinePages(editor), [editor])

  useEffect(() => {
    if (!pages.length) return
    function onPointer(info: TLEventInfo) {
      if (info.type !== 'pointer' || (info.name !== 'pointer_down' && info.name !== 'pointer_up')) return
      const point = editor.screenToPage(info.point)
      const index = pages.findIndex(id => editor.getShape(id)?.parentId === editor.getCurrentPageId()
        && editor.getShapePageBounds(id)?.containsPoint(point))
      if (index >= 0) selectZinePage(editor, index)
    }
    editor.on('before-event', onPointer)
    return () => { editor.off('before-event', onPointer) }
  }, [editor, pages])

  const canvas = editor.getContainer().closest('.ca-canvas')
  if (!pages.length || !canvas) return null
  const zh = lang === 'zh'
  const pageName = (i: number) => zh ? `第 ${i + 1} 页` : `Page ${i + 1}`
  return createPortal(<nav className="ca-zine-nav" aria-label={zh ? '书页' : 'Book pages'} onPointerDown={e => e.stopPropagation()}>
    {pages.map((id, i) => <button key={id} type="button" aria-label={pageName(i)}
      aria-current={i === active ? 'page' : undefined}
      data-spread-start={i % 2 === 1 || undefined}
      onClick={() => { editor.complete(); editor.selectNone(); focusZinePage(editor, i) }}>
      {i === 0 ? (zh ? '封面' : 'Cover') : i === pages.length - 1 ? (zh ? '封底' : 'Back') : i + 1}
    </button>)}
    <button type="button" className="ca-zine-play" title={t('frameToolbar.playFullscreen')}
      aria-label={t('frameToolbar.playFullscreen')} onClick={() => { editor.complete(); openBookPreview(pages, active) }}>
      <span className="ca-icon">{Icons.play}</span>
    </button>
  </nav>, canvas)
}

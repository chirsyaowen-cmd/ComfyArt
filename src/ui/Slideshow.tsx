import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { atom, useValue, type Editor, type TLShapeId } from 'tldraw'

import { exportImage } from '../shapes/ArtboardShape'
import { Icons } from './icons'
import { lang, t } from '../i18n'

export const slideshowAtom = atom<{ ids: TLShapeId[]; index: number } | null>('slideshow', null)

const bookPreview = atom<{ ids: TLShapeId[]; index: number } | null>('book preview', null)
const ZineReader = lazy(() => import('./ZineReader').catch(() => ({
  default: ({ onClose }: { onClose: () => void }) => <div className="ca-book-loading" role="alert">
    <p>{lang === 'zh' ? '翻书组件加载失败，请保存作品并刷新页面。' : 'Could not load the reader. Save your work and reload the page.'}</p>
    <button type="button" onClick={onClose}>{t('slideshow.exit')}</button>
  </div>,
})))

export function openBookPreview(ids: TLShapeId[], index: number) {
  bookPreview.set({ ids, index })
}

function closeBookPreview() { bookPreview.set(null) }

function BookPreview({ editor, ids, index }: { editor: Editor; ids: TLShapeId[]; index: number }) {
  const root = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = root.current
    if (!dialog) return
    const opener = document.activeElement
    dialog.showModal()
    let disposed = false
    let ownsFullscreen = false
    const host = document.documentElement
    // Defer the request until React has finished its development-only effect replay.
    queueMicrotask(async () => {
      if (disposed || document.fullscreenElement || !host.requestFullscreen) return
      try {
        await host.requestFullscreen()
        ownsFullscreen = true
        if (disposed && document.fullscreenElement === host) await document.exitFullscreen()
      } catch { /* The modal still fills the viewport when fullscreen is unavailable. */ }
    })
    const onExit = () => {
      if (ownsFullscreen && !document.fullscreenElement) closeBookPreview()
    }
    document.addEventListener('fullscreenchange', onExit)
    return () => {
      disposed = true
      document.removeEventListener('fullscreenchange', onExit)
      dialog.close()
      if (ownsFullscreen && document.fullscreenElement === host) void document.exitFullscreen().catch(() => {})
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={root} className="ca-book-preview" aria-label={lang === 'zh' ? '小志预览' : 'Book preview'}
    onCancel={e => { e.preventDefault(); closeBookPreview() }} onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); closeBookPreview() }
    }}>
    <Suspense fallback={<div className="ca-book-loading" role="status">{lang === 'zh' ? '正在打开小志…' : 'Opening book…'}</div>}>
      <ZineReader editor={editor} ids={ids} index={index} onClose={closeBookPreview} />
    </Suspense>
  </dialog>
}

const SCALE = 2

export function Slideshow({ editor }: { editor: Editor }) {
  const book = useValue(bookPreview)
  if (book) return <BookPreview editor={editor} ids={book.ids} index={book.index} />
  return <ArtboardSlideshow editor={editor} />
}

function ArtboardSlideshow({ editor }: { editor: Editor }) {
  const show = useValue(slideshowAtom)
  const root = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const id = show?.ids[show.index]

  useEffect(() => {
    if (!id) return
    let alive = true
    let made: string | null = null
    void exportImage(editor, [id], { format: 'png', scale: SCALE, background: true }).then(({ blob }) => {
      if (!alive) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [editor, id])

  useEffect(() => {
    if (!show) return
    void root.current?.requestFullscreen?.().catch(() => undefined)
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      const s = slideshowAtom.get()
      if (!s) return
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') slideshowAtom.set({ ...s, index: Math.min(s.ids.length - 1, s.index + 1) })
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') slideshowAtom.set({ ...s, index: Math.max(0, s.index - 1) })
    }
    const onExit = () => { if (!document.fullscreenElement) slideshowAtom.set(null) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onExit)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onExit)
    }
  }, [!!show])

  if (!show) return null
  function close() {
    slideshowAtom.set(null)
    setUrl(null)
    if (document.fullscreenElement) void document.exitFullscreen()
  }
  const go = (d: number) => slideshowAtom.set({ ...show, index: Math.max(0, Math.min(show.ids.length - 1, show.index + d)) })

  return (
    <div ref={root} className="ca-slideshow" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}>
      {url && <img src={url} alt="" />}
      <div className="ca-slideshow__bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.previous')} disabled={!show.index} onClick={() => go(-1)}><span className="ca-icon ca-slideshow__prev">{Icons.next}</span></button>
        <span>{show.index + 1} / {show.ids.length}</span>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.next')} disabled={show.index >= show.ids.length - 1} onClick={() => go(1)}><span className="ca-icon">{Icons.next}</span></button>
        <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('slideshow.exit')} onClick={close}><span className="ca-icon">{Icons.close}</span></button>
      </div>
    </div>
  )
}

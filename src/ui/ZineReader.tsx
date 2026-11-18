import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'

import { lang, t } from '../i18n'
import { exportImage } from '../shapes/ArtboardShape'
import { SPREADS } from '../zine'
import { BookSpread } from './BookSpread'
import { Icons } from './icons'
import '../styles/zine-reader.css'

type Direction = -1 | 1
type View =
  | { phase: 'open'; spread: number }
  | { phase: 'preparing' | 'turning'; spread: number; direction: Direction }

function pageImages(editor: Editor, ids: TLShapeId[]) {
  const images = new Map<number, string>()
  const pending = new Map<number, Promise<void>>()
  const urls = new Set<string>()
  let closed = false

  async function load(page: number) {
    const id = ids[page]
    const bounds = editor.getShapePageBounds(id)
    if (!bounds) throw new Error('Missing zine page')
    const { blob } = await exportImage(editor, [id], {
      format: 'png', bounds, padding: 0, scale: 2, pixelRatio: 1, background: true,
    })
    if (closed) return
    const url = URL.createObjectURL(blob)
    urls.add(url)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!closed) images.set(page, url)
    } catch (error) {
      urls.delete(url)
      URL.revokeObjectURL(url)
      throw error
    }
  }

  function ensure(page: number) {
    if (closed || images.has(page)) return Promise.resolve()
    const running = pending.get(page)
    if (running) return running
    const task = load(page).finally(() => pending.delete(page))
    pending.set(page, task)
    return task
  }

  return {
    images,
    ensure,
    close() {
      closed = true
      urls.forEach(url => URL.revokeObjectURL(url))
      urls.clear()
      images.clear()
    },
  }
}

type ReaderProps = { editor: Editor; ids: TLShapeId[]; index: number; onClose: () => void }

export default function ZineReader({ editor, ids, index, onClose }: ReaderProps) {
  const [view, setView] = useState<View>(() => ({
    phase: 'open', spread: Math.max(0, SPREADS.findIndex(pages => pages.includes(index))),
  }))
  const [images, setImages] = useState<ReadonlyMap<number, string>>(() => new Map())
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const cache = useRef<ReturnType<typeof pageImages> | null>(null)

  useEffect(() => {
    const session = pageImages(editor, ids)
    cache.current = session
    return () => { session.close(); cache.current = null }
  }, [editor, ids])

  useEffect(() => {
    const session = cache.current
    if (!session || view.phase === 'turning') return
    let cancelled = false
    let idleTimer: number | undefined
    setFailed(false)

    async function prepare(pages: NonNullable<typeof session>) {
      const next = view.phase === 'preparing' ? view.spread + view.direction : view.spread
      await Promise.all(SPREADS[next].map(pages.ensure))
      if (cancelled) return
      setImages(new Map(pages.images))
      if (view.phase === 'preparing') {
        setView(window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? { phase: 'open', spread: next }
          : { ...view, phase: 'turning' })
        return
      }

      // Let the current spread paint before nearby photos start exporting.
      idleTimer = window.setTimeout(async () => {
        const neighbors = [SPREADS[next + 1], SPREADS[next - 1]]
        for (const page of neighbors.flatMap(spread => spread ?? [])) {
          if (cancelled) return
          await pages.ensure(page).catch(() => undefined)
        }
      }, 80)
    }
    void prepare(session).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; window.clearTimeout(idleTimer) }
  }, [view, editor, ids, attempt])

  const ready = SPREADS[view.spread].every(page => images.has(page))
  const turn = useCallback((direction: Direction) => {
    if (!ready) return
    setView(current => {
      if (current.phase !== 'open' || !SPREADS[current.spread + direction]) return current
      return { phase: 'preparing', spread: current.spread, direction }
    })
  }, [ready])

  const finish = useCallback(() => {
    setView(current => current.phase === 'turning'
      ? { phase: 'open', spread: current.spread + current.direction }
      : current)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === ' ' && event.target instanceof HTMLButtonElement) return
      const previous = event.key === 'ArrowLeft' || event.key === 'PageUp'
      const next = event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' '
      if (!previous && !next) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) turn(previous ? -1 : 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [turn])

  const zh = lang === 'zh'
  const pages = SPREADS[view.spread]
  const label = view.spread === 0 ? (zh ? '封面' : 'Cover')
    : view.spread === SPREADS.length - 1 ? (zh ? '封底' : 'Back cover')
    : pages.map(page => page + 1).join('–')
  const busy = view.phase !== 'open' || !ready

  return (
    <div className="ca-zine-reader">
      <div className="ca-zine-reader__stage">
        {ready && <BookSpread images={images} spread={view.spread}
          turn={view.phase === 'turning' ? view.direction : null} onTurnEnd={finish} onTurn={turn} />}
        {failed ? <div className="ca-zine-reader__notice" role="alert">
          {zh ? '书页加载失败' : 'Could not load the page'}
          <button type="button" onClick={() => setAttempt(value => value + 1)}>{zh ? '重试' : 'Retry'}</button>
        </div> : (!ready || view.phase === 'preparing') &&
          <div className="ca-zine-reader__notice" role="status">{t('assetPicker.loading')}</div>}
      </div>
      <div className="ca-zine-reader__controls">
        <button type="button" title={t('slideshow.previous')} aria-label={t('slideshow.previous')}
          disabled={busy || view.spread === 0} onClick={() => turn(-1)}>
          <span className="ca-icon ca-zine-reader__prev">{Icons.next}</span>
        </button>
        <span className="ca-zine-reader__position" aria-live="polite">{label}</span>
        <button type="button" title={t('slideshow.next')} aria-label={t('slideshow.next')}
          disabled={busy || view.spread === SPREADS.length - 1} onClick={() => turn(1)}>
          <span className="ca-icon">{Icons.next}</span>
        </button>
        <button type="button" className="ca-zine-reader__close" onClick={onClose}>{t('slideshow.exit')}</button>
      </div>
    </div>
  )
}

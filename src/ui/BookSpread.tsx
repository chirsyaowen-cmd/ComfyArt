import { useLayoutEffect, useRef } from 'react'
import { lang, t } from '../i18n'
import '../styles/book-spread.css'

type Direction = -1 | 1

interface BookSpreadProps {
  images: ReadonlyMap<number, string>
  spread: number
  turn: Direction | null
  onTurnEnd: () => void
  onTurn: (direction: Direction) => void
}

const stripCount = 20
const strips = Array.from({ length: stripCount }, (_, index) => index)
const turnDuration = 650

// A closed cover occupies only half the spread; shift its spine to center the book.
function spreadOffset(spread: number) {
  if (spread === 0) return -25
  if (spread === 4) return 25
  return 0
}

function pageLabel(index: number) {
  return lang === 'zh' ? `第 ${index + 1} 页` : `Page ${index + 1}`
}

export function BookSpread({ images, spread, turn, onTurnEnd, onTurn }: BookSpreadProps) {
  const book = useRef<HTMLDivElement>(null)
  const leaf = useRef<HTMLDivElement>(null)
  const done = useRef(onTurnEnd)
  useLayoutEffect(() => { done.current = onTurnEnd }, [onTurnEnd])

  // The same physical leaf turns in either direction. Its even index is its front.
  const rightSpread = turn === -1 ? spread - 1 : spread
  const front = rightSpread * 2
  const left = front - 1
  const right = turn ? front + 2 : front

  useLayoutEffect(() => {
    const paper = leaf.current
    const stack = book.current
    if (!turn || !paper || !stack) return

    const slices = Array.from(paper.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
    const offset = spreadOffset(spread)
    const targetOffset = spreadOffset(spread + turn)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const start = performance.now()

    function draw(now: number) {
      if (!paper || !stack) return
      const elapsed = motion.matches ? 1 : Math.min(1, (now - start) / turnDuration)
      const eased = (1 - Math.cos(elapsed * Math.PI)) / 2
      const progress = turn === 1 ? eased : 1 - eased
      const curl = Math.sin(progress * Math.PI)
      const stripWidth = paper.getBoundingClientRect().width / stripCount
      stack.style.transform = `translateX(${offset + (targetOffset - offset) * eased}%)`

      // Walk outward from the spine. Each strip begins at the previous strip's free edge.
      let x = 0
      let z = 0
      for (const [index, slice] of slices.entries()) {
        const along = (index + 0.5) / stripCount
        const angle = Math.PI * progress + curl * (along - 0.5) * 1.2
        slice.style.transform = `translate3d(${x}px, 0, ${z}px) rotateY(${-angle}rad)`
        slice.style.setProperty('--shade', String(Math.abs(Math.sin(angle)) * 0.19))
        x += Math.cos(angle) * stripWidth
        z += Math.sin(angle) * stripWidth
      }
      if (elapsed >= 1) done.current()
      else frame = requestAnimationFrame(draw)
    }

    draw(start)
    return () => cancelAnimationFrame(frame)
  }, [spread, turn])

  function page(index: number, side: 'left' | 'right') {
    if (index < 0 || index > 7) return null
    const src = images.get(index)
    const direction = side === 'left' ? -1 : 1
    const action = t(direction === -1 ? 'slideshow.previous' : 'slideshow.next')
    return <button type="button" className={`ca-book-page ca-book-page--${side}`}
      disabled={turn !== null} aria-label={`${pageLabel(index)} · ${action}`} onClick={() => onTurn(direction)}>
      {src && <img src={src} alt="" draggable={false} />}
    </button>
  }

  return <div className="ca-book-stage">
    <div className="ca-book-spread" ref={book} style={{ transform: `translateX(${spreadOffset(spread)}%)` }}>
      {page(left, 'left')}
      {page(right, 'right')}
      {turn !== null && <div className="ca-book-leaf" ref={leaf} aria-hidden="true">
        {strips.map(index => <div key={index} className="ca-book-strip" style={{ width: `${100 / stripCount}%` }}>
          {[front, front + 1].map((face, side) => {
            const src = images.get(face)
            const column = side === 0 ? index : stripCount - 1 - index
            return <div key={face} className={`ca-book-face${side === 1 ? ' ca-book-face--back' : ''}`}
              style={{ backgroundImage: src ? `url("${src}")` : undefined, backgroundSize: `${stripCount * 100}% 100%`,
                backgroundPosition: `${100 * column / (stripCount - 1)}% center` }} />
          })}
        </div>)}
      </div>}
    </div>
  </div>
}

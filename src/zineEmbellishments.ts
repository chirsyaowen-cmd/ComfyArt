import { createShapeId, getHashForString, getIndexBetween, renderPlaintextFromRichText, type Editor, type TLFrameShape, type TLShapeId } from 'tldraw'

import { roadmap } from './roadmap'
import { artboardStyle } from './shapes/ArtboardShape'
import { TEXT } from './shapes/TextShape'
import { VECTOR, type VectorShape } from './shapes/VectorShape'
import { getZinePages } from './zine'
import { t } from './i18n'

type Kind = 'color-block' | 'star'
type Area = { x: number; y: number; w: number; h: number }
type Placement = Area & { id: Kind; fill: string; below?: TLShapeId }
export type EmbellishmentOffer = { frame: string; version: string; options: Kind[] }
type Decision = { version: string; choice: 'applied' | 'skipped' }

function pageFrame(editor: Editor, id: string) {
  const frameId = getZinePages(editor).find(page => page === id)
  const frame = frameId && editor.getShape(frameId)
  return frame && frame.type === 'frame' ? frame : undefined
}

function pageShapes(editor: Editor, frame: TLFrameShape) {
  return [...editor.getShapeAndDescendantIds([frame.id])].flatMap(id => editor.getShape(id) ?? [])
}

function copyOnPage(editor: Editor, frame: TLFrameShape) {
  return pageShapes(editor, frame).filter(shape =>
    shape.type === TEXT ? shape.props.text.trim() : shape.type === 'text' && renderPlaintextFromRichText(editor, shape.props.richText).trim())
}

function decision(frame: TLFrameShape): Decision | undefined {
  const value = frame.meta.zineEmbellishment
  if (typeof value !== 'object' || !value || !('version' in value) || !('choice' in value)) return
  if (typeof value.version === 'string' && (value.choice === 'applied' || value.choice === 'skipped')) {
    return { version: value.version, choice: value.choice }
  }
}

export function embellishmentPageStatus(editor: Editor, id: string) {
  const frame = pageFrame(editor, id)
  return frame && decision(frame)?.choice
}

function readyPage(editor: Editor, id: string) {
  const frame = pageFrame(editor, id)
  if (!frame) return
  const steps = roadmap(editor).steps.filter(step => step.targetFrameIds.includes(frame.id))
  if (steps.some(step => step.type === 'photo_adjust' && (step.status === 'pending' || step.status === 'in_progress'))) return
  const stage = steps.find(step => step.type === 'embellishment')
  const copy = copyOnPage(editor, frame)
  if (stage && copy.length) return { frame, stage, copy }
}

const overlaps = (a: Area, b: Area) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function pageBounds(editor: Editor, frame: TLFrameShape, id: TLShapeId): Area | undefined {
  const bounds = editor.getShapePageBounds(id)
  if (!bounds) return
  const corners = bounds.corners.map(point => editor.getPointInShapeSpace(frame, point))
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

function rgb(color: string) {
  const match = /^#([\da-f]{6})$/i.exec(color)
  if (!match) return
  return [0, 2, 4].map(i => Number.parseInt(match[1].slice(i, i + 2), 16))
}

function palette(paper: string, ink: string) {
  const paperRgb = rgb(paper)
  const text = rgb(ink) ?? [20, 20, 20]
  const colorful = [paperRgb, text].find(channels => channels && Math.max(...channels) - Math.min(...channels) > 18)
  const hue = colorful ?? [100, 133, 170]
  const base = 0.2126 * text[0] + 0.7152 * text[1] + 0.0722 * text[2] > 150 ? 25 : 255
  return { block: `#${hue.map(c => Math.round(c * 0.25 + base * 0.75).toString(16).padStart(2, '0')).join('')}`,
    star: `#${hue.map(c => Math.round(c * 0.76).toString(16).padStart(2, '0')).join('')}` }
}

function placements(editor: Editor, page: NonNullable<ReturnType<typeof readyPage>>): Placement[] {
  const { frame, copy } = page
  const title = copy.find(shape => shape.meta.textRole === 'title') ?? copy[0]
  const textBounds = pageBounds(editor, frame, title.id)
  const { w, h } = frame.props
  if (!textBounds || w < 24 || h < 24) return []
  const margin = Math.min(w, h) * 0.045
  const colors = palette(artboardStyle(frame).fill ?? '', title.type === TEXT ? title.props.color : '#202020')
  const blockW = clamp(textBounds.w + margin / 2, w * 0.1, w * 0.32)
  const blockH = clamp(textBounds.h * 0.6, h * 0.018, h * 0.085)
  let below = title.id
  for (const ancestor of editor.getShapeAncestors(title)) {
    if (ancestor.parentId === frame.id) { below = ancestor.id; break }
  }
  const block: Placement = { id: 'color-block', fill: colors.block, below, w: blockW, h: blockH,
    x: clamp(textBounds.x - margin / 4, margin, w - margin - blockW),
    y: clamp(textBounds.y + textBounds.h - blockH * 0.8, margin, h - margin - blockH) }
  const size = Math.min(w, h) * 0.045
  const occupied = pageShapes(editor, frame).flatMap(shape => {
    if (shape.id === frame.id || shape.type === 'group' || shape.type === 'comment') return []
    const bounds = pageBounds(editor, frame, shape.id)
    // Full-bleed artwork is the backdrop. Smaller images and text reserve their own space.
    if (!bounds || (shape.type !== TEXT && shape.type !== 'text' && bounds.w >= w * 0.92 && bounds.h >= h * 0.92)) return []
    return [bounds]
  })
  const star: Placement = { id: 'star', fill: colors.star, w: size, h: size, x: 0, y: 0 }
  const candidates = [0, 1, 2, 3, 4].flatMap(row => [0, 1, 2, 3, 4].map(column => ({ ...star,
    x: margin + (w - 2 * margin - size) * (4 - column) / 4,
    y: margin + (h - 2 * margin - size) * (4 - row) / 4,
  })))
  const space = candidates.find(place => ![block, ...occupied].some(area => overlaps(place, area)))
  return space ? [block, space] : [block]
}

function versionOf(editor: Editor, frame: TLFrameShape) {
  const shapes = pageShapes(editor, frame).map(shape => {
    if (shape.type !== TEXT) return shape
    // The text component measures these dimensions after the lettering is placed.
    return { ...shape, props: { ...shape.props, h: 0, w: shape.props.autoSize ? 0 : shape.props.w } }
  })
  return getHashForString(JSON.stringify(shapes))
}

export function makeEmbellishmentOffer(editor: Editor, id: string, reopen = false): EmbellishmentOffer | undefined {
  const page = readyPage(editor, id)
  if (!page) return
  const previous = decision(page.frame)
  if (previous?.choice === 'applied' || (!reopen && (previous || ['deferred', 'done'].includes(page.stage.status)))) return
  const options = placements(editor, page).map(option => option.id)
  if (options.length) return { frame: id, version: versionOf(editor, page.frame), options }
}

export function embellishmentOfferStatus(editor: Editor, offer: EmbellishmentOffer) {
  const frame = pageFrame(editor, offer.frame)
  if (!frame) return 'stale'
  const previous = decision(frame)
  if (previous?.version === offer.version || previous?.choice === 'applied') return previous.choice
  return versionOf(editor, frame) === offer.version && readyPage(editor, offer.frame) ? 'open' : 'stale'
}

export function decideEmbellishments(editor: Editor, offer: EmbellishmentOffer, selection: Kind[] | 'skip') {
  if (editor.getIsReadonly() || editor.isDisposed || embellishmentOfferStatus(editor, offer) !== 'open') throw new Error(t('embellishment.stale'))
  const page = readyPage(editor, offer.frame)
  if (!page) throw new Error(t('embellishment.stale'))
  const { frame } = page
  const siblings = editor.getSortedChildIdsForParent(frame.id).flatMap(id => editor.getShape(id) ?? [])
  const selected = selection === 'skip' ? [] : placements(editor, page).filter(place => selection.includes(place.id) && offer.options.includes(place.id))
  if (selection !== 'skip' && (!selected.length || selected.length !== selection.length)) throw new Error(t('embellishment.stale'))
  const shapes = selected.map(({ below, id, x, y, w, h, fill }) => {
    const index = siblings.findIndex(shape => shape.id === below)
    return { id: createShapeId(), type: VECTOR, parentId: frame.id, x, y,
      index: index < 0 ? getIndexBetween(siblings.at(-1)?.index ?? null, null)
        : getIndexBetween(siblings[index - 1]?.index ?? null, siblings[index].index),
      props: { kind: id === 'star' ? 'star' : 'rect', w, h, fill, stroke: '', sides: 5 },
    } as const
  })
  if (shapes.length && !editor.canCreateShapes(shapes)) throw new Error(t('embellishment.cannotAdd'))
  editor.markHistoryStoppingPoint('zine embellishments')
  editor.run(() => {
    if (shapes.length) editor.createShapes<VectorShape>(shapes)
    editor.updateShape({ id: frame.id, type: 'frame', meta: { ...frame.meta,
      zineEmbellishment: { version: offer.version, choice: selection === 'skip' ? 'skipped' : 'applied' },
    } })
  })
  editor.markHistoryStoppingPoint('zine embellishments added')
}

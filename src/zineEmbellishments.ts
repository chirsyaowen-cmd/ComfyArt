import { createShapeId, getHashForString, type Editor, type TLFrameShape } from 'tldraw'

import { roadmap } from './roadmap'
import { exportImage } from './shapes/ArtboardShape'
import { uuid } from './id'
import { VECTOR, polygonPoints, type VectorShape } from './shapes/VectorShape'
import { getZinePages } from './zine'
import { textShapesOnPage } from './zineText'
import { t } from './i18n'

type Mark = { kind: 'rect' | 'ellipse' | 'star'; x: number; y: number; w: number; h: number; rotation: number; fill: string }
export type EmbellishmentOffer = { id: string; frame: string; version: string; preview: string; reason: string; marks: Mark[] }
type Decision = { version: string; proposal?: string; choice: 'applied' | 'skipped' }

function pageFrame(editor: Editor, id: string) {
  const frameId = getZinePages(editor).find(page => page === id)
  const frame = frameId && editor.getShape(frameId)
  return frame && frame.type === 'frame' ? frame : undefined
}

function pageShapes(editor: Editor, frame: TLFrameShape) {
  return [...editor.getShapeAndDescendantIds([frame.id])].flatMap(id => editor.getShape(id) ?? [])
}

function decision(frame: TLFrameShape): Decision | undefined {
  const value = frame.meta.zineEmbellishment
  if (typeof value !== 'object' || !value || !('version' in value) || !('choice' in value)) return
  if (typeof value.version === 'string' && (value.choice === 'applied' || value.choice === 'skipped')) {
    return { version: value.version, choice: value.choice, proposal: typeof value.proposal === 'string' ? value.proposal : undefined }
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
  const copy = textShapesOnPage(editor, frame.id)
  if (stage && copy.length) return { frame, stage, copy }
}

export function canRequestEmbellishments(editor: Editor, id: string) {
  const page = readyPage(editor, id)
  return !!page && decision(page.frame)?.choice !== 'applied'
}

function versionOf(editor: Editor, frame: TLFrameShape) {
  return getHashForString(JSON.stringify(pageShapes(editor, frame).sort((a, b) => a.id.localeCompare(b.id))))
}

function isMark(input: unknown): input is Mark {
  if (!input || typeof input !== 'object') return false
  const m = input as Record<string, unknown>
  return ['rect', 'ellipse', 'star'].some(kind => kind === m.kind)
    && [m.x, m.y, m.w, m.h, m.rotation].every(Number.isFinite)
    && typeof m.w === 'number' && m.w > 0 && typeof m.h === 'number' && m.h > 0
    && typeof m.fill === 'string' && /^#[0-9a-f]{6}$/i.test(m.fill)
}

export async function previewEmbellishments(editor: Editor, id: string, reason: unknown, marks: unknown) {
  const frame = pageFrame(editor, id)
  if (!frame || !canRequestEmbellishments(editor, id)) throw new Error(t('embellishment.unavailable'))
  if (typeof reason !== 'string' || !reason.trim() || !Array.isArray(marks) || !marks.length || !marks.every(isMark))
    throw new Error('Supply a rationale and shapes with valid geometry and hex colors.')
  const version = versionOf(editor, frame)
  const { w, h } = frame.props
  const { blob } = await exportImage(editor, [frame.id], { format: 'png', padding: 0, background: true, scale: Math.min(1, 960 / Math.max(w, h)), pixelRatio: 1 })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  ctx.scale(canvas.width / w, canvas.height / h)
  for (const m of marks) {
    ctx.save()
    ctx.translate(m.x, m.y)
    ctx.rotate(m.rotation * Math.PI / 180)
    ctx.fillStyle = m.fill
    ctx.beginPath()
    if (m.kind === 'rect') ctx.rect(0, 0, m.w, m.h)
    else if (m.kind === 'ellipse') ctx.ellipse(m.w / 2, m.h / 2, m.w / 2, m.h / 2, 0, 0, 2 * Math.PI)
    else polygonPoints('star', m.w, m.h, 5).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.fill()
    ctx.restore()
  }
  const offer = { id: uuid(), frame: id, version, reason, marks, preview: canvas.toDataURL('image/jpeg', 0.85) }
  if (embellishmentOfferStatus(editor, offer) !== 'open') throw new Error(t('embellishment.stale'))
  return offer
}

export function embellishmentOfferStatus(editor: Editor, offer: EmbellishmentOffer) {
  const frame = pageFrame(editor, offer.frame)
  if (!frame) return 'stale'
  const previous = decision(frame)
  if (previous && (previous.proposal ? previous.proposal === offer.id : previous.version === offer.version)) return previous.choice
  if (!offer.preview || previous?.choice === 'applied') return 'stale'
  return versionOf(editor, frame) === offer.version && readyPage(editor, offer.frame) ? 'open' : 'stale'
}

export function decideEmbellishments(editor: Editor, offer: EmbellishmentOffer, selection: 'apply' | 'skip') {
  if (editor.getIsReadonly() || editor.isDisposed || embellishmentOfferStatus(editor, offer) !== 'open') throw new Error(t('embellishment.stale'))
  const frame = pageFrame(editor, offer.frame)!
  const shapes = (selection === 'apply' ? offer.marks : []).map(({ kind, x, y, w, h, rotation, fill }) => ({
    id: createShapeId(), type: VECTOR, parentId: frame.id, x, y, rotation: rotation * Math.PI / 180,
    props: { kind, w, h, fill, stroke: '', sides: 5 },
  } as const))
  if (shapes.length && !editor.canCreateShapes(shapes)) throw new Error(t('embellishment.cannotAdd'))
  editor.markHistoryStoppingPoint('zine embellishments')
  editor.run(() => {
    if (shapes.length) editor.createShapes<VectorShape>(shapes)
    editor.updateShape({ id: frame.id, type: 'frame', meta: { ...frame.meta,
      zineEmbellishment: { version: offer.version, proposal: offer.id, choice: selection === 'skip' ? 'skipped' : 'applied' },
    } })
  })
  editor.markHistoryStoppingPoint('zine embellishments added')
}

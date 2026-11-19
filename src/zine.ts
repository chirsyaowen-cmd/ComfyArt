import { Box, createShapeId, isShapeId, type Editor, type TLFrameShape, type TLPageId, type TLShapeId } from 'tldraw'

import { lang } from './i18n'

export const ZINE_PAPER_STYLE = { fill: '#fffefa', stroke: '#cecac1' }

const WIDTH = 480
const HEIGHT = 680
const SPREAD_GAP = 32
const ROW_CAPACITY = 8
const INITIAL_PAGE_COUNT = 8

export function zineSpreads(count: number) {
  const spreads: number[][] = [[0]]
  for (let left = 1; left < count - 1; left += 2) spreads.push([left, left + 1])
  spreads.push([count - 1])
  return spreads
}

export function zinePositions(count: number) {
  let x = 0
  let y = 0
  let occupied = 0
  const positions: { x: number; y: number }[] = []
  for (const spread of zineSpreads(count)) {
    if (occupied + spread.length > ROW_CAPACITY) {
      occupied = 0
      x = 0
      y += HEIGHT + SPREAD_GAP
    }
    for (const _page of spread) {
      positions.push({ x, y })
      x += WIDTH
    }
    occupied += spread.length
    x += SPREAD_GAP
  }
  return positions
}

export function getZinePages(editor: Editor): TLShapeId[] {
  const ids = editor.getDocumentSettings().meta.zinePages
  return Array.isArray(ids) && ids.length >= INITIAL_PAGE_COUNT && ids.length % 2 === 0
    && ids.every((id): id is TLShapeId => typeof id === 'string' && isShapeId(id)) ? ids : []
}

function blankPage(id: TLShapeId, parentId: TLPageId, index: number, position: { x: number; y: number }) {
  return {
    id, type: 'frame' as const, parentId, ...position,
    props: { w: WIDTH, h: HEIGHT, name: String(index + 1) },
    meta: { style: { ...ZINE_PAPER_STYLE } },
  }
}

export function createZine(editor: Editor) {
  const frames = zinePositions(INITIAL_PAGE_COUNT).map((pos, index) => blankPage(createShapeId(), editor.getCurrentPageId(), index, pos))
  if (editor.getIsReadonly() || !editor.canCreateShapes(frames)) return
  editor.run(() => {
    editor.createShapes(frames)
    editor.updateDocumentSettings({
      name: lang === 'zh' ? '未命名小志' : 'Untitled Zine',
      meta: { ...editor.getDocumentSettings().meta, zinePages: frames.map(frame => frame.id) },
    })
  })
}

export function addZineSpread(editor: Editor) {
  if (editor.getIsReadonly()) return
  editor.complete()
  const pages = getZinePages(editor)
  const insertAt = pages.length - 1
  const back = pages.length ? editor.getShape<TLFrameShape>(pages[insertAt]) : undefined
  if (back?.type !== 'frame' || back.parentId !== editor.getCurrentPageId()) return
  const positions = zinePositions(pages.length + 2)
  const frames = [insertAt, insertAt + 1].map(i => blankPage(createShapeId(), editor.getCurrentPageId(), i, positions[i]))
  if (!editor.canCreateShapes(frames)) return

  editor.markHistoryStoppingPoint('add zine spread')
  editor.run(() => {
    const doc = editor.getDocumentSettings()
    const order = [...pages.slice(0, insertAt), ...frames.map(frame => frame.id), back.id]
    // Store the page order in the same undo step as the frames. The frame rules read it below.
    editor.store.put([{ ...doc, meta: { ...doc.meta, zinePages: order } }])
    editor.createShapes(frames)
    editor.updateShape<TLFrameShape>({
      id: back.id, type: 'frame', ...positions[order.length - 1],
      props: back.props.name === String(pages.length) ? { name: String(order.length) } : {},
    })
    editor.selectNone()
  }, { ignoreShapeLock: true })
  editor.markHistoryStoppingPoint()
  selectZinePage(editor, insertAt)
}

// Normalize saved books before the editor fixes their paper positions.
export function restoreZineLayout(editor: Editor) {
  const pages = getZinePages(editor)
  if (!pages.length) return
  const positions = zinePositions(pages.length)
  const moves = pages.flatMap((id, page) => {
    const frame = editor.getShape(id)
    const { x, y } = positions[page]
    return frame?.type === 'frame' && (frame.x !== x || frame.y !== y)
      ? [{ id, type: 'frame' as const, x, y }]
      : []
  })
  if (moves.length) editor.run(() => editor.updateShapes(moves), { history: 'ignore', ignoreShapeLock: true })
}

export function activeZineIndex(editor: Editor) {
  const index = editor.getInstanceState().meta.zinePageIndex
  if (typeof index !== 'number' || !Number.isInteger(index)) return 0
  return Math.max(0, Math.min(index, getZinePages(editor).length - 1))
}

export function selectZinePage(editor: Editor, index: number) {
  if (index !== editor.getInstanceState().meta.zinePageIndex) editor.updateInstanceState({ meta: { ...editor.getInstanceState().meta, zinePageIndex: index } })
}

export function fileInsertionPoint(editor: Editor) {
  const page = getZinePages(editor)[activeZineIndex(editor)]
  return (page && editor.getShapePageBounds(page)?.center) || editor.getViewportPageBounds().center
}

export function focusZinePage(editor: Editor, index: number) {
  const pages = getZinePages(editor)
  if (!pages[index]) return
  const spread = zineSpreads(pages.length)[Math.ceil(index / 2)]
  selectZinePage(editor, index)
  const bounds = spread.flatMap(i => editor.getShapePageBounds(pages[i]) ?? [])
  if (bounds.length) editor.zoomToBounds(Box.Common(bounds), { inset: 128, targetZoom: 1 })
}

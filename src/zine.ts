import { Box, createShapeId, isShapeId, type Editor, type TLShapeId } from 'tldraw'

import { lang } from './i18n'

const WIDTH = 480
const HEIGHT = 680
const SPREAD_GAP = 32
const SPREADS = [[0], [1, 2], [3, 4], [5, 6], [7]]

const PAGE_X = SPREADS.flatMap((spread, group) => spread.map(page => page * WIDTH + group * SPREAD_GAP))

export function getZinePages(editor: Editor): TLShapeId[] {
  const ids = editor.getDocumentSettings().meta.zinePages
  return Array.isArray(ids) && ids.length === 8 && ids.every(id => typeof id === 'string' && isShapeId(id)) ? ids as TLShapeId[] : []
}

export function createZine(editor: Editor) {
  const pages = PAGE_X.map(() => createShapeId())
  editor.run(() => {
    editor.createShapes(PAGE_X.map((x, page) => ({
      id: pages[page], type: 'frame', parentId: editor.getCurrentPageId(), x, y: 0,
      props: { w: WIDTH, h: HEIGHT, name: String(page + 1) },
      meta: { style: { fill: '#fffefa', stroke: '#cecac1' } },
    })))
    editor.updateDocumentSettings({
      name: lang === 'zh' ? '未命名小志' : 'Untitled Zine',
      meta: { ...editor.getDocumentSettings().meta, zinePages: pages },
    })
  })
}

// Normalize saved books before the editor fixes their paper positions.
export function restoreZineLayout(editor: Editor) {
  const moves = getZinePages(editor).flatMap((id, page) => {
    const frame = editor.getShape(id)
    return frame?.type === 'frame' && frame.x !== PAGE_X[page]
      ? [{ id, type: 'frame' as const, x: PAGE_X[page] }]
      : []
  })
  if (moves.length) editor.run(() => editor.updateShapes(moves), { history: 'ignore' })
}

export function activeZineIndex(editor: Editor) {
  const index = editor.getInstanceState().meta.zinePageIndex
  return typeof index === 'number' ? index : 0
}

export function selectZinePage(editor: Editor, index: number) {
  if (index !== activeZineIndex(editor)) editor.updateInstanceState({ meta: { ...editor.getInstanceState().meta, zinePageIndex: index } })
}

export function fileInsertionPoint(editor: Editor) {
  const page = getZinePages(editor)[activeZineIndex(editor)]
  return (page && editor.getShapePageBounds(page)?.center) || editor.getViewportPageBounds().center
}

export function focusZinePage(editor: Editor, index: number) {
  const pages = getZinePages(editor)
  const spread = SPREADS.find(group => group.includes(index))
  if (!pages.length || !spread) return
  selectZinePage(editor, index)
  const bounds = spread.flatMap(i => editor.getShapePageBounds(pages[i]) ?? [])
  if (bounds.length) editor.zoomToBounds(Box.Common(bounds), { inset: 128, targetZoom: 1 })
}

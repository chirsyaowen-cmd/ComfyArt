import { Box, createShapeId, isShapeId, type Editor, type TLShapeId } from 'tldraw'

import { lang } from './i18n'

const WIDTH = 480
const HEIGHT = 680
const GAP = WIDTH * 2
const SPREADS = [[0], [1, 2], [3, 4], [5, 6], [7]]

export function getZinePages(editor: Editor): TLShapeId[] {
  const ids = editor.getDocumentSettings().meta.zinePages
  return Array.isArray(ids) && ids.length === 8 && ids.every(id => typeof id === 'string' && isShapeId(id)) ? ids as TLShapeId[] : []
}

export function createZine(editor: Editor) {
  const pages = Array.from({ length: 8 }, () => createShapeId())
  let x = 0
  editor.run(() => {
    for (const spread of SPREADS) {
      for (const page of spread) {
        editor.createShape({
          id: pages[page], type: 'frame', parentId: editor.getCurrentPageId(), x, y: 0,
          props: { w: WIDTH, h: HEIGHT, name: String(page + 1) },
          meta: { style: { fill: '#fffefa', stroke: '#cecac1' } },
        })
        x += WIDTH
      }
      x += GAP
    }
    editor.updateDocumentSettings({
      name: lang === 'zh' ? '未命名小志' : 'Untitled Zine',
      meta: { ...editor.getDocumentSettings().meta, zinePages: pages },
    })
  })
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

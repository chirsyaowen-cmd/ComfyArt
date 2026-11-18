import { useEffect } from 'react'
import { defaultHandleExternalFileContent, useEditor, useToasts, useTranslation, type Editor, type TLShape } from 'tldraw'

import { fileInsertionPoint, selectZinePage, getZinePages } from '../zine'
import { placeEmbed } from '../embeds'
import { errorText } from '../jobs'
import { isPdf, placePdf } from '../pdf'

const GAP = 20

export function importFiles(editor: Editor, accept: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length) void editor.putExternalContent({ type: 'files', files, point: fileInsertionPoint(editor) })
  }
  input.click()
}

function lineUp(editor: Editor, shapes: TLShape[]) {
  const boxes = shapes.map((s) => ({ s, b: editor.getShapePageBounds(s)! })).sort((a, b) => a.b.x - b.b.x)
  const mid = boxes[0].b.y + Math.max(...boxes.map(({ b }) => b.h)) / 2
  let x = boxes[0].b.x
  editor.run(() => {
    for (const { s, b } of boxes) {
      editor.updateShape({ id: s.id, type: s.type, x: s.x + x - b.x, y: s.y + mid - b.h / 2 - b.y })
      x += b.w + GAP
    }
  }, { history: 'ignore' })
}

export function DropHandlers({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const toasts = useToasts()
  const msg = useTranslation()

  useEffect(() => {
    editor.registerExternalContentHandler('files', async ({ point, files }) => {
      const rest: File[] = []
      for (const file of files) {
        try {
          if (isPdf(file)) await placePdf(editor, file, point)
          else if (!(await placeEmbed(editor, file, point))) rest.push(file)
        } catch (e) {
          onError(errorText(e))
        }
      }
      if (!rest.length) return
      const page = point && getZinePages(editor).find((id) => editor.getShapePageBounds(id)?.containsPoint(point))
      if (page) selectZinePage(editor, getZinePages(editor).indexOf(page))
      const before = new Set(editor.getCurrentPageShapeIds())
      await defaultHandleExternalFileContent(editor, { point, files: rest }, { toasts, msg })
      if (page) {
        const images = editor.getSelectedShapes().filter((shape) => shape.type === 'image' && !before.has(shape.id))
        if (images.length) editor.reparentShapes(images, page)
      }
      const added = editor.getCurrentPageShapes().filter((s) => !before.has(s.id) && s.parentId === editor.getCurrentPageId())
      if (added.length > 1) lineUp(editor, added)
    })
  }, [editor, toasts, msg, onError])

  return null
}

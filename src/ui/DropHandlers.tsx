import { useEffect } from 'react'
import { defaultHandleExternalFileContent, useEditor, useToasts, useTranslation, type Editor, type TLShape } from 'tldraw'

import { placeAsset } from '../assets'
import { viewUrl } from '../comfy'
import { PHOTO_ACCEPT, importPhotos, isHeif, isPhoto, photoImportAtom, uploadPhoto } from '../photoImport'
import { libraryTabAtom } from './LibraryPanel'
import { sideAtom } from './SidePanel'
import { activeZineIndex, fileInsertionPoint, selectZinePage, getZinePages } from '../zine'
import { placeEmbed } from '../embeds'
import { errorText } from '../jobs'
import { isPdf, placePdf } from '../pdf'

const GAP = 20

export function importFiles(editor: Editor, accept: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept === 'image/*' ? PHOTO_ACCEPT : accept
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
    if (photoImportAtom.get().length) {
      libraryTabAtom.set('import')
      sideAtom.set('assets')
    }
    editor.registerExternalContentHandler('files', async ({ point, files }) => {
      const pages = getZinePages(editor)
      const photos = files.filter(isPhoto)
      const batch = photos.length > 0 && pages.length > 0
      if (batch) {
        importPhotos(photos)
        libraryTabAtom.set('import')
        sideAtom.set('assets')
      }
      const rest: File[] = []
      for (const file of files) {
        if (batch && isPhoto(file)) continue
        try {
          if (isHeif(file)) {
            const page = pages.find(id => point && editor.getShapePageBounds(id)?.containsPoint(point)) ?? pages[activeZineIndex(editor)]
            const photo = await uploadPhoto(file)
            await placeAsset(editor, { name: file.name, src: viewUrl(photo.ref), kind: 'image' }, page)
          } else if (isPdf(file)) await placePdf(editor, file, point)
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

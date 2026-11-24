import { useEffect } from 'react'
import { getDefaultCrop, type Editor, type TLImageShape } from 'tldraw'

const MAX_ZOOM = 4
const WHEEL_GESTURE_MS = 250

export function useCropWheel(editor: Editor, imageId: TLImageShape['id'] | undefined) {
  useEffect(() => {
    if (!imageId) return
    const host = editor.getContainer()
    let previous: TLImageShape | undefined
    let lastWheel = -Infinity

    const onWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.tl-canvas')) return
      if (!editor.isIn('select.crop.idle') || editor.getCroppingShapeId() !== imageId || editor.getIsReadonly()) return
      const shape = editor.getShape<TLImageShape>(imageId)
      if (!shape || editor.isShapeOrAncestorLocked(shape)) return

      const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
      if (editor.getShapeAtPoint(point, { hitInside: true })?.id !== shape.id) return
      const local = editor.getPointInShapeSpace(shape, point)
      const x = local.x / shape.props.w
      const y = local.y / shape.props.h

      event.preventDefault()
      event.stopPropagation()
      const crop = shape.props.crop ?? getDefaultCrop()
      const w = crop.bottomRight.x - crop.topLeft.x
      const h = crop.bottomRight.y - crop.topLeft.y
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1
      const factor = Math.exp(event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002))
      const span = Math.max(w, h)
      // A crop made with the handles may already be smaller than the wheel limit.
      const scale = Math.min(1 / span, Math.max(Math.min(1, 1 / (MAX_ZOOM * span)), factor))
      if (scale === 1) return
      const width = Math.min(1, w * scale)
      const height = Math.min(1, h * scale)
      const left = Math.max(0, Math.min(1 - width, crop.topLeft.x + x * (w - width)))
      const top = Math.max(0, Math.min(1 - height, crop.topLeft.y + y * (h - height)))

      if (shape !== previous || event.timeStamp - lastWheel > WHEEL_GESTURE_MS) {
        editor.markHistoryStoppingPoint('zoom crop')
      }
      editor.updateShape<TLImageShape>({
        id: shape.id, type: 'image',
        props: { crop: { ...crop, topLeft: { x: left, y: top }, bottomRight: { x: left + width, y: top + height } } },
      })
      previous = editor.getShape<TLImageShape>(shape.id)
      lastWheel = event.timeStamp
    }

    host.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => host.removeEventListener('wheel', onWheel, true)
  }, [editor, imageId])
}

import { renderPlaintextFromRichText, type Editor, type TLShapeId } from 'tldraw'
import { TEXT } from './shapes/TextShape'

export function textShapesOnPage(editor: Editor, frame: TLShapeId) {
  const shapes = [...editor.getShapeAndDescendantIds([frame])].flatMap(id => editor.getShape(id) ?? [])
  return shapes.filter(shape => shape.type === TEXT ? shape.props.text.trim()
    : shape.type === 'text' && renderPlaintextFromRichText(editor, shape.props.richText).trim())
}

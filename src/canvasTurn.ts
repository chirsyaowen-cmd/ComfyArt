import type { Editor, TLShapeId } from 'tldraw'
import { activeZineIndex, getZinePages } from './zine'
import { uuid } from './id'
import { CLIENT_ID } from './ws'

export type CanvasTurn = { token: string; frame: TLShapeId; inspected: boolean
  reviewVersion?: string
  embellishmentDraft?: import('./zineEmbellishments').EmbellishmentOffer; purpose?: 'canvas_review' | 'embellishment' | 'schedule'
  viewedFrames: Map<TLShapeId, string>; placedText: Set<TLShapeId> }
const turns = new WeakMap<Editor, CanvasTurn>()
const pendingTurns = new WeakMap<Editor, Map<string, CanvasTurn>>()
export function matchingCanvasTurn(editor: Editor, token?: string) {
  const turn = turns.get(editor)
  return turn?.token === token ? turn : undefined
}
export function prepareCanvasTurn(editor: Editor, purpose?: CanvasTurn['purpose']) {
  const pages = getZinePages(editor)
  if (!pages.length) return undefined
  const turn: CanvasTurn = { token: CLIENT_ID + ":" + uuid(), purpose,
    frame: pages[activeZineIndex(editor)], inspected: false, viewedFrames: new Map(), placedText: new Set() }
  const pending = pendingTurns.get(editor) ?? new Map<string, CanvasTurn>()
  pending.set(turn.token, turn)
  pendingTurns.set(editor, pending)
  return turn.token
}
export function discardCanvasTurn(editor: Editor, token: string) {
  pendingTurns.get(editor)?.delete(token)
}
export function activateCanvasTurn(editor: Editor, token: string) {
  const turn = pendingTurns.get(editor)?.get(token)
  if (!turn) return
  discardCanvasTurn(editor, token)
  turns.set(editor, turn)
}
export const currentCanvasTurn = (editor: Editor) => turns.get(editor)?.token
export function checkCanvasTurn(editor: Editor, token: string) {
  const active = turns.get(editor)
  if (!active || active.token !== token) throw new Error('TASK_SUPERSEDED: a newer request or editor session took over')
  if (editor.isDisposed || editor.getIsReadonly()) throw new Error('Project editor is closed or read-only')
  return active
}

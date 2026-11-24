import type { Editor, TLFrameShape, TLShapeId, VecLike } from 'tldraw'

import { api, isViewUrl, refFromUrl } from './comfy'
import { getZinePages } from './zine'
import type { DragEvent } from 'react'
import { t } from './i18n'
import { placeMedia, toMedia, type MediaKind } from './jobs'

interface ApiAsset { id: string; name: string; mime_type?: string; preview_url?: string; metadata?: { width?: number; height?: number } }
export interface AssetItem { id: string; name: string; src: string; w: number; h: number; kind: MediaKind }

const PAGE = 60

export async function listAssets(tags: string, search: string, after?: string): Promise<{ items: AssetItem[]; next: string | null }> {
  const q = new URLSearchParams({ tags_any: tags, limit: String(PAGE) })
  if (search) q.set('name_contains', search)
  if (after) q.set('after', after)
  const res = await api(`/assets?${q}`)
  if (res.status === 503) throw new Error(t('assetPicker.disabled'))
  if (!res.ok) throw new Error(`assets: ${res.status}`)
  const { assets, next_cursor } = await res.json()
  const items = (assets as ApiAsset[]).flatMap((a): AssetItem[] => {
    const kind = String(a.mime_type ?? '').split('/')[0]
    if ((kind !== 'image' && kind !== 'video') || !a.preview_url) return []
    return [{ id: a.id, name: a.name, src: a.preview_url, w: a.metadata?.width ?? 0, h: a.metadata?.height ?? 0, kind }]
  })
  return { items, next: next_cursor ?? null }
}

const PHOTO_DRAG_TYPE = 'application/x-comfyart-photo'

export function photoDragProps(src: string, name: string) {
  return {
    draggable: true,
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      event.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify({ src, name }))
      event.dataTransfer.effectAllowed = 'copy'
    },
  }
}

export function dropLibraryPhoto(editor: Editor, transfer: DataTransfer, point: VecLike, onError: (e: unknown) => void) {
  const raw = transfer.getData(PHOTO_DRAG_TYPE)
  if (!raw) return false
  try {
    const photo: unknown = JSON.parse(raw)
    if (typeof photo === 'object' && photo !== null && 'src' in photo && typeof photo.src === 'string'
      && isViewUrl(photo.src) && 'name' in photo && typeof photo.name === 'string') {
      const page = getZinePages(editor).find(id => editor.getAncestorPageId(id) === editor.getCurrentPageId()
        && editor.getShapePageBounds(id)?.containsPoint(point))
      void placeAsset(editor, { src: photo.src, name: photo.name, kind: 'image' }, page, point).catch(onError)
    }
  } catch (e) { onError(e) }
  return true
}

export async function placeAsset(editor: Editor, item: Pick<AssetItem, 'src' | 'name' | 'kind'>, pageId?: TLShapeId, point?: VecLike): Promise<TLShapeId> {
  const canvasId = editor.getCurrentPageId()
  const m = await toMedia(refFromUrl(item.src), item.kind)
  const page = pageId ? editor.getShape<TLFrameShape>(pageId) : undefined
  if (pageId && page?.type !== 'frame') throw new Error(t('home.projectNotFound'))
  const w = page ? Math.min(m.w, page.props.w, page.props.h * m.w / m.h) : Math.min(m.w, 512)
  let center = point ?? editor.getViewportPageBounds().center
  if (page) center = point ? editor.getPointInShapeSpace(page, point) : { x: page.props.w / 2, y: page.props.h / 2 }
  editor.markHistoryStoppingPoint('place asset')
  const id = placeMedia(editor, m, item.name, center.x - w / 2, center.y - w * m.h / m.w / 2, w, page?.id ?? (point ? canvasId : undefined))
  editor.select(id)
  return id
}

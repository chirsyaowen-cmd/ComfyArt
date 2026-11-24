import type { Editor, TLFrameShape, TLShapeId } from 'tldraw'

import { api, refFromUrl } from './comfy'
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

export async function placeAsset(editor: Editor, item: Pick<AssetItem, 'src' | 'name' | 'kind'>, pageId?: TLShapeId): Promise<TLShapeId> {
  const m = await toMedia(refFromUrl(item.src), item.kind)
  if (pageId) {
    const page = editor.getShape<TLFrameShape>(pageId)
    if (!page || page.type !== 'frame') throw new Error(t('home.projectNotFound'))
    const w = Math.min(m.w, page.props.w, page.props.h * m.w / m.h)
    editor.markHistoryStoppingPoint('place photo in zine')
    const id = placeMedia(editor, m, item.name, (page.props.w - w) / 2, (page.props.h - w * m.h / m.w) / 2, w, pageId)
    editor.select(id)
    return id
  }
  const center = editor.getViewportPageBounds().center
  const w = Math.min(m.w, 512)
  const id = placeMedia(editor, m, item.name, center.x - w / 2, center.y - w * m.h / m.w / 2, w)
  editor.select(id)
  return id
}

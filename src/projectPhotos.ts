import { react, type Editor, type TLShapeId } from 'tldraw'
import { placeAsset } from './assets'
import { api, viewUrl } from './comfy'
import { photoImportAtom, refreshPhotos, type Uploaded } from './photoImport'
import { focusZinePage, getZinePages } from './zine'
import { uuid } from './id'

type ProjectPhoto = { key: string; state: Uploaded['state']; name: string; ref: { filename: string; subfolder: string; type: string } }
type Library = { photos: ProjectPhoto[]; batch: string[] }
export function projectPhotos(editor: Editor): Library {
  return editor.getDocumentSettings().meta.projectPhotos as Library ?? { photos: [], batch: [] }
}

// Keep source references in the project snapshot. Only in-flight File objects live in the tab.
export function trackProjectPhotos(editor: Editor) {
  if (!getZinePages(editor).length) return () => {}
  const meta = editor.getDocumentSettings().meta
  if ('roadmap' in meta || 'roadmapPhotos' in meta) {
    const { roadmap: _obsolete, roadmapPhotos: photos, ...rest } = meta
    editor.updateDocumentSettings({ meta: { ...rest, ...(photos && !rest.projectPhotos ? { projectPhotos: photos } : {}) } })
  }
  const saved = projectPhotos(editor)
  const rows = photoImportAtom.get()
  const settled = rows.every(row => row.stage.kind === 'stored')
  if (saved.batch.length && settled) {
    photoImportAtom.set(saved.batch.flatMap(key => {
      const photo = saved.photos.find(p => p.key === key)
      return photo ? [{ id: uuid(), name: photo.name, size: 0, modified: 0, stage: { kind: 'stored' as const, photo } }] : []
    }))
  }
  let timer = 0
  const stop = react('project photo references', () => {
    const rows = photoImportAtom.get()
    if (!rows.length) return
    const current = projectPhotos(editor)
    const photos = new Map(current.photos.map(photo => [photo.key, photo]))
    const batch = new Set<string>()
    for (const row of rows) {
      if (row.stage.kind !== 'stored') continue
      const photo = { ...row.stage.photo, name: row.name }
      batch.add(photo.key)
      photos.set(photo.key, photo)
    }
    const next = { photos: [...photos.values()], batch: [...batch] }
    if (JSON.stringify(next) !== JSON.stringify(current)) editor.run(() =>
      editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, projectPhotos: next } }), { history: 'ignore' })
    const pending = rows.some(row => row.stage.kind === 'stored' && row.stage.photo.state === 'pending')
    if (pending && !timer) timer = window.setInterval(() => void refreshPhotos(), 800)
    else if (!pending && timer) { clearInterval(timer); timer = 0 }
  })
  return () => { stop(); clearInterval(timer) }
}

const observations = new WeakMap<Editor, Map<TLShapeId, { records: unknown[]; version: string }>>()
export function frameFacts(editor: Editor, id: TLShapeId) {
  let cache = observations.get(editor)
  if (!cache) { cache = new Map(); observations.set(editor, cache) }
  const children = editor.getShapeAndDescendantIds([id])
  const records = Array.from(children, shape => editor.getShape(shape))
  let seen = cache.get(id)
  if (!seen || seen.records.length !== records.length || records.some((r, i) => r !== seen!.records[i])) {
    seen = { records, version: uuid() }
    cache.set(id, seen)
  }
  return { id, frame_version: seen.version, contentCount: records.length - 1,
    imageCount: records.filter(r => r?.type === 'image').length }
}

export type Placement = { frame: string; frame_version: string; photo_key: string; fit: 'cover' | 'contain' }
export async function placeProjectPhoto(editor: Editor, args: Placement, checkTask: () => void) {
  function check() {
    checkTask()
    if (editor.isDisposed || editor.getIsReadonly()) throw new Error('Project editor is closed or read-only')
    const frame = getZinePages(editor).find(id => id === args.frame && editor.getShape(id)?.type === 'frame')
    if (!frame || frameFacts(editor, frame).frame_version !== args.frame_version) throw new Error('FRAME_CONFLICT: read get_canvas again')
    const library = projectPhotos(editor)
    const photo = library.batch.includes(args.photo_key) && library.photos.find(p => p.key === args.photo_key && p.state === 'ready')
    if (!photo || !['cover', 'contain'].includes(args.fit)) throw new Error('Expected a ready project photo and cover or contain')
    return { frame, photo }
  }
  const { frame, photo } = check()
  const response = await api('/comfyart/photos/' + photo.key, { cache: 'no-store' })
  const actual: Uploaded | null = response.ok ? await response.json() : null
  if (!actual || actual.key !== photo.key || actual.state !== 'ready') throw new Error('PHOTO_UNAVAILABLE: choose an available upload')
  const id = await placeAsset(editor, { kind: 'image', name: photo.name, src: viewUrl(actual.ref) }, frame, undefined,
    { cover: args.fit === 'cover', check })
  focusZinePage(editor, getZinePages(editor).indexOf(frame))
  return { id, frame, photo_key: photo.key }
}

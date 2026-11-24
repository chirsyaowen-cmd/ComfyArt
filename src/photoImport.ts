import { atom } from 'tldraw'

import { api, type ImageRef } from './comfy'
import { t } from './i18n'
import { uuid } from './id'

export const PHOTO_ACCEPT = 'image/*,.heic,.heif,.heics,.heifs'
export const isHeif = (file: File) => /\.hei[cf]s?$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)
export const isPhoto = (file: File) => file.type.startsWith('image/') || isHeif(file) || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)

type ThumbState = 'pending' | 'ready' | 'failed'
export type Uploaded = { key: string; ref: ImageRef; state: ThumbState }
type Stage = { kind: 'waiting' | 'uploading' | 'missing' } | { kind: 'error'; message: string } | { kind: 'stored'; photo: Uploaded }
type Entry = { id: string; name: string; size: number; modified: number; stage: Stage }

const sessionKey = 'comfyart.photo-import.' + (new URL(location.href).searchParams.get('project') ?? '')
function restore(): Entry[] {
  try {
    const rows: Entry[] = JSON.parse(sessionStorage.getItem(sessionKey) ?? '[]')
    return rows.map(row => row.stage.kind === 'stored' ? row : { ...row, stage: { kind: 'missing' } })
  } catch { return [] }
}

export const photoImportAtom = atom<Entry[]>('photo import', restore())
const files = new Map<string, File>()
let running = 0
let polling = false

function save(rows: Entry[]) {
  photoImportAtom.set(rows)
  try { sessionStorage.setItem(sessionKey, JSON.stringify(rows)) } catch { /* Storage may be disabled. */ }
}
function update(id: string, stage: Stage) {
  save(photoImportAtom.get().map(row => row.id === id ? { ...row, stage } : row))
}

export async function uploadPhoto(file: File): Promise<Uploaded> {
  if (file.size > 64 * 1024 * 1024) throw new Error(t('photoImport.tooLarge'))
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const key = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
  const existing = await api('/comfyart/photos/' + key, { cache: 'no-store' })
  if (existing.ok) {
    const photo: Uploaded | null = await existing.json()
    if (photo) return photo
  }
  const form = new FormData()
  form.append('image', file)
  const res = await api('/comfyart/photos', { method: 'POST', body: form })
  if (!res.ok) throw new Error(res.status === 413 ? t('photoImport.tooLarge') : t('photoImport.uploadError', res.status))
  return res.json()
}

function pump() {
  const waiting = photoImportAtom.get().filter(row => row.stage.kind === 'waiting')
  for (const row of waiting.slice(0, 3 - running)) {
    const file = files.get(row.id)
    if (!file) { update(row.id, { kind: 'missing' }); continue }
    running++
    update(row.id, { kind: 'uploading' })
    void uploadPhoto(file).then(photo => {
      files.delete(row.id)
      update(row.id, { kind: 'stored', photo })
      void refreshPhotos()
    }).catch(e => update(row.id, { kind: 'error', message: String(e.message ?? e) }))
      .finally(() => { running--; pump() })
  }
}

export function importPhotos(input: File[]) {
  const previous = photoImportAtom.get()
  const finished = previous.every(row => row.stage.kind === 'stored' && row.stage.photo.state === 'ready')
  // Re-selecting the original batch resumes only its missing uploads, even with repeated filenames.
  const resuming = previous.some(row => row.stage.kind === 'missing')
  const matches = resuming ? [...previous] : []
  const rows = finished ? [] : [...previous]
  for (const file of input) {
    const i = matches.findIndex(row => row.name === file.name && row.size === file.size && row.modified === file.lastModified)
    const prior = i < 0 ? undefined : matches.splice(i, 1)[0]
    if (prior?.stage.kind === 'uploading' || prior?.stage.kind === 'waiting') continue
    const row: Entry = { id: prior?.id ?? uuid(), name: file.name, size: file.size, modified: file.lastModified, stage: { kind: 'waiting' } }
    if (prior) rows[rows.indexOf(prior)] = row
    else rows.push(row)
    files.set(row.id, file)
  }
  save(rows)
  pump()
  void refreshPhotos()
}

export async function refreshPhotos() {
  if (polling) return
  polling = true
  try {
    const keys = [...new Set(photoImportAtom.get().flatMap(row =>
      row.stage.kind === 'stored' && row.stage.photo.state === 'pending' ? [row.stage.photo.key] : []))]
    const states: Record<string, ThumbState> = {}
    for (let i = 0; i < keys.length; i += 500) {
      const res = await api('/comfyart/photos/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(keys.slice(i, i + 500)) })
      if (!res.ok) break
      Object.assign(states, await res.json())
    }
    const rows = photoImportAtom.get()
    if (rows.some(row => row.stage.kind === 'stored' && states[row.stage.photo.key] && states[row.stage.photo.key] !== row.stage.photo.state)) {
      save(rows.map(row => {
        if (row.stage.kind !== 'stored') return row
        const photo = row.stage.photo
        return states[photo.key] ? { ...row, stage: { kind: 'stored', photo: { ...photo, state: states[photo.key] } } } : row
      }))
    }
  } catch { /* Poll again once the local service is reachable. */ }
  finally { polling = false }
}

export async function retryPhoto(row: Entry) {
  if (row.stage.kind === 'stored') {
    const photo = row.stage.photo
    const res = await api('/comfyart/photos/' + photo.key + '/retry', { method: 'POST' })
    if (!res.ok) throw new Error(t('photoImport.uploadError', res.status))
    update(row.id, { kind: 'stored', photo: { ...photo, state: 'pending' } })
  } else {
    update(row.id, { kind: files.has(row.id) ? 'waiting' : 'missing' })
    pump()
  }
}

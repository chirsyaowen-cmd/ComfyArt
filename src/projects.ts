import type { TLEditorSnapshot, TLRecord } from 'tldraw'

import { api } from './comfy'
import { t } from './i18n'
import { uuid } from './id'

export const UNTITLED = t('projectHeader.untitled')
const COVERS = 2

export interface ProjectEntry { id: string; name: string; updated: number; covers?: string[] | null; pinned?: boolean }

const url = (id: string, rest = '') => `/comfyart/projects/${encodeURIComponent(id)}${rest}`
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await api(path, init)
  if (res.status === 404) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${path} failed: ${res.status}`)
  return body as T
}

const revisions = new Map<string, string>()

export async function loadProject(id: string): Promise<TLEditorSnapshot | null> {
  const res = await api(url(id), { cache: 'no-store' })
  if (res.status === 404) {
    revisions.delete(id)
    return null
  }
  const revision = res.headers.get('ETag')
  if (!res.ok || !revision) throw new Error(`Cannot open project (${res.status})`)
  const snapshot: TLEditorSnapshot = await res.json()
  revisions.set(id, revision)
  return snapshot
}

export async function saveProject(id: string, snapshot: TLEditorSnapshot, name: string, covers: string[]) {
  const init = send('PUT', { snapshot, name, covers })
  const expected = revisions.get(id)
  const res = await api(url(id), { ...init, headers: { ...init.headers, ...(expected ? { 'If-Match': expected } : {}) } })
  if (!res.ok) throw new Error((await res.json()).error ?? `Save failed (${res.status})`)
  const revision = res.headers.get('ETag')
  if (!revision) throw new Error('Missing saved project revision')
  revisions.set(id, revision)
}

export async function listProjects(): Promise<ProjectEntry[]> {
  return (await call<{ projects: ProjectEntry[] }>('/comfyart/projects'))?.projects ?? []
}

export function coversOf(records: TLRecord[]): string[] {
  const srcs = new Map<string, string>()
  for (const r of records) if (r.typeName === 'asset' && r.type === 'image' && r.props.src?.startsWith('/')) srcs.set(r.id, r.props.src)
  const used = records.flatMap((r) => (r.typeName === 'shape' && r.type === 'image' && r.props.assetId && srcs.has(r.props.assetId) ? [srcs.get(r.props.assetId)!] : []))
  return [...new Set(used)].slice(-COVERS).reverse()
}

export async function fillCovers(entries: ProjectEntry[]): Promise<ProjectEntry[]> {
  return Promise.all(entries.map(async (e) => {
    if (e.covers) return e
    const covers = coversOf(Object.values((await loadProject(e.id))?.document.store ?? {}))
    await call(url(e.id), send('PATCH', { covers }))
    return { ...e, covers }
  }))
}

export const renameProject = (id: string, name: string) => call(url(id), send('PATCH', { name }))

export const setPinned = (id: string, pinned: boolean) => call(url(id), send('PATCH', { pinned }))

export async function deleteProjects(ids: string[]) {
  await Promise.all(ids.map((id) => call(url(id), { method: 'DELETE' })))
}

export async function duplicateProject(id: string): Promise<string> {
  const entry = (await listProjects()).find((e) => e.id === id)
  if (!entry) throw new Error(t('home.projectNotFound'))
  const copy = uuid().slice(0, 8)
  await call(url(id, '/duplicate'), send('POST', { id: copy, name: t('projects.copyName', entry.name || UNTITLED) }))
  return copy
}

export function projectUrl(id: string, params: Record<string, string | string[]> = {}) {
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('project', id)
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) url.searchParams.append(k, x)
  return url.toString()
}

export function openProject(id: string) {
  location.assign(projectUrl(id))
}

export const NEW_PARAM = 'new'

export function newProject(params: Record<string, string | string[]> = {}) {
  location.assign(projectUrl(uuid().slice(0, 8), { [NEW_PARAM]: '1', ...params }))
}

export function openView(view: 'home' | 'projects') {
  const url = new URL(location.pathname, location.origin)
  if (view === 'projects') url.searchParams.set('view', 'projects')
  location.assign(url)
}

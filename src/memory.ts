import { atom } from 'tldraw'

import { api } from './comfy'
import { currentProject } from './notices'
import { t } from './i18n'

export type Scope = 'project' | 'global'
export interface Memory { scope: Scope | 'legacy'; can_assign?: boolean; id: string; text: string; time: number; category?: string }
export interface MemoryInput { text: string; category?: string; global_request?: string }
export interface MemoryLog { scope: Scope | 'legacy'; time: number; action: 'add' | 'update' | 'forget' | 'skill'; text: string; source: string }

export const MEMORY_CATEGORIES: [string, string, string][] = [
  ['about', t('memory.basics'), 'About the user'], ['taste', t('memory.aestheticPreferences'), 'Visual taste'], ['work', t('memory.collaborationStyle'), 'Way of working'], ['assets', t('memory.frequentAssets'), 'Long-term assets'],
]
const CATEGORY_IDS = MEMORY_CATEGORIES.map(([id]) => id)

export function toInputs(value: unknown): MemoryInput[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v) => {
    const text = typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : ''
    const category = CATEGORY_IDS.includes(v?.category) ? v.category : undefined
    const quote = typeof v?.global_request === 'string' ? v.global_request.trim() : undefined
    return text.trim() ? [{ text: text.trim(), category, ...(quote ? { global_request: quote } : {}) }] : []
  })
}

export const memoryAtom = atom<Memory[]>('project memories', [])
export const legacyAtom = atom<Memory[]>('unassigned legacy memories', [])
export const memoryLogAtom = atom<MemoryLog[]>('memory log', [])
let lastRead = 0

function endpoint(project: string) {
  return '/comfyart/projects/' + encodeURIComponent(project) + '/memory'
}

export async function loadMemory(project = currentProject()) {
  if (!project) return []
  const seq = ++lastRead
  const res = await api(endpoint(project))
  if (!res.ok) throw new Error('Unable to load project memory')
  const data: { memories: Memory[]; legacy: Memory[]; log: MemoryLog[] } = await res.json()
  if (seq === lastRead && project === currentProject()) {
    memoryAtom.set(data.memories)
    legacyAtom.set(data.legacy)
    memoryLogAtom.set(data.log)
  }
  return data.memories
}

async function change(project: string, body: object) {
  const res = await api(endpoint(project), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error((await res.json()).error || 'Memory update failed')
}

export async function remember(items: MemoryInput[], source: string, scope: Scope = 'project', sourceMessageId?: string) {
  const project = currentProject()
  for (const item of items) {
    const target = sourceMessageId && item.global_request ? 'global' : scope
    await change(project, { action: 'add', ...item, source, scope: target, source_message_id: sourceMessageId })
  }
  return loadMemory(project)
}

export async function editMemory(action: 'correct' | 'forget' | 'assign' | 'skill', fields: { id?: string; text?: string; scope?: Scope; source?: string }) {
  const project = currentProject()
  await change(project, { action, ...fields })
  return loadMemory(project)
}

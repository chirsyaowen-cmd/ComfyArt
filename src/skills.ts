import { atom } from 'tldraw'

import { deleteUserFile, listUserFiles, readUserText, uploadImage, viewUrl, writeUserText } from './comfy'
import { t } from './i18n'
import { uuid } from './id'

export interface Skill { id: string; name: string; instructions: string; files?: Record<string, string>; images?: Record<string, string>; custom?: boolean; learned?: string[] }
export interface SkillVersion { time: number; skill: Skill }

const ROOT = 'comfyart/skills'
const TEXT_FILE = /\.(md|txt|json|csv|ya?ml|html?|css|js|ts|svg)$/i
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i

export const BUILTIN_SKILLS: Skill[] = [
  { id: 'poster', name: t('skills.posterDesign'), instructions: 'Design a poster with a clear visual hierarchy. Use render_vectorcraft for illustration, add_text for editable titles, and view_canvas to review.' },
  { id: 'brand', name: t('skills.brandIdentity'), instructions: 'Use render_vectorcraft for an original vector mark. Place editable typography and color swatches alongside it.' },
]

export const skillAtom = atom<Skill | null>('skill', null)

const listFiles = (dir: string) => listUserFiles(`${ROOT}/${dir}`.replace(/\/$/, ''), true)
const read = (path: string) => readUserText(`${ROOT}/${path}`)
const write = (path: string, body: string) => writeUserText(`${ROOT}/${path}`, body)
const remove = (path: string) => deleteUserFile(`${ROOT}/${path}`)

export function toMarkdown(skill: Skill): string {
  return `---\nname: ${skill.name}\n---\n\n${skill.instructions}\n`
}

export function parseMarkdown(text: string): { name: string; instructions: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const name = m ? /^name:\s*(.+)$/m.exec(m[1])?.[1].trim() ?? '' : ''
  return { name, instructions: (m ? m[2] : text).trim() }
}

async function readSkill(id: string, paths: string[]): Promise<Skill | null> {
  const md = await read(`${id}/SKILL.md`)
  if (md === null) return null
  const { name, instructions } = parseMarkdown(md)
  const files: Record<string, string> = {}
  for (const p of paths.filter((p) => p.startsWith('files/'))) files[p.slice(6)] = (await read(`${id}/${p}`)) ?? ''
  const images = paths.includes('images.json') ? JSON.parse((await read(`${id}/images.json`)) ?? '{}') as Record<string, string> : {}
  const learned = paths.includes('learned.json') ? JSON.parse((await read(`${id}/learned.json`)) ?? '[]') as string[] : undefined
  return { id, name: name || id, instructions, files, images, custom: true, ...(learned ? { learned } : {}) }
}

export async function loadSkills(): Promise<Skill[]> {
  const byId = new Map<string, string[]>()
  for (const f of await listFiles('')) {
    const [id, ...rest] = f.split('/')
    byId.set(id, [...(byId.get(id) ?? []), rest.join('/')])
  }
  const custom = await Promise.all([...byId].filter(([, paths]) => paths.includes('SKILL.md')).map(([id, paths]) => readSkill(id, paths)))
  return [...custom.filter((s): s is Skill => !!s), ...BUILTIN_SKILLS]
}

export async function saveSkill(skill: Skill) {
  const paths = await listFiles(skill.id)
  const current = paths.includes('SKILL.md') ? await readSkill(skill.id, paths) : null
  if (current) await write(`${skill.id}/versions/${Date.now()}.json`, JSON.stringify(current))
  const files = skill.files ?? {}
  await write(`${skill.id}/SKILL.md`, toMarkdown(skill))
  await write(`${skill.id}/images.json`, JSON.stringify(skill.images ?? {}))
  if (skill.learned) await write(`${skill.id}/learned.json`, JSON.stringify(skill.learned))
  for (const [path, content] of Object.entries(files)) await write(`${skill.id}/files/${path}`, content)
  for (const p of paths.filter((p) => p.startsWith('files/') && !(p.slice(6) in files))) await remove(`${skill.id}/${p}`)
}

export async function deleteSkill(id: string) {
  for (const p of await listFiles(id)) await remove(`${id}/${p}`)
}

export async function listVersions(id: string): Promise<SkillVersion[]> {
  const names = (await listFiles(`${id}/versions`)).filter((f) => f.endsWith('.json')).sort().reverse()
  const out: SkillVersion[] = []
  for (const f of names) {
    const text = await read(`${id}/versions/${f}`)
    if (text) out.push({ time: Number(f.replace('.json', '')), skill: JSON.parse(text) as Skill })
  }
  return out
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || uuid().slice(0, 8)

export async function uploadSkillImage(file: File, id: string): Promise<string> {
  return viewUrl(await uploadImage(file, `skill-${id}-${file.name}`))
}


export async function importFolder(list: FileList): Promise<{ skill: Skill; skipped: string[] }> {
  const files = Array.from(list)
  const md = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.webkitRelativePath || f.name))
  if (!md) throw new Error(t('skills.noSkillMdInFolder'))
  const root = (md.webkitRelativePath || md.name).replace(/SKILL\.md$/i, '')
  const parsed = parseMarkdown(await md.text())
  const folder = root.replace(/\/$/, '').split('/').pop() ?? ''
  const id = slug(folder || parsed.name)
  const extra: Record<string, string> = {}
  const images: Record<string, string> = {}
  const skipped: string[] = []
  for (const f of files) {
    const path = (f.webkitRelativePath || f.name).slice(root.length)
    if (f === md || !path) continue
    if (TEXT_FILE.test(path)) extra[path] = await f.text()
    else if (IMAGE_FILE.test(path)) images[path] = await uploadSkillImage(f, id)
    else skipped.push(path)
  }
  const skill: Skill = { id, name: parsed.name || folder, instructions: parsed.instructions, files: extra, images, custom: true }
  await saveSkill(skill)
  return { skill, skipped }
}

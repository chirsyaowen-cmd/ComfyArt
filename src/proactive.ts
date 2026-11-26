import { Box, react, type Editor, type TLShapeId } from 'tldraw'

import { api, readUserJson, uploadImage, viewUrl, writeUserJson } from './comfy'
import { botEnabledAtom, chatsAtom, settingsAtom, type BotMessage } from './bot'
import { errorText, type ErrorSink } from './jobs'
import { ask, parseJson } from './llm'
import { editMemory, loadMemory, remember, toInputs } from './memory'
import { currentProject, notify } from './notices'
import { exportImage } from './shapes/ArtboardShape'
import { loadSkills, saveSkill, slug } from './skills'
import { onComfyEvent } from './ws'
import { currentRoadmapTurn } from './roadmap'
import { guideShown, roadmapGuide } from './roadmapGuide'
import { inspectZine, describeZine } from './zineReview'
import { lang, t } from './i18n'

export type Ability = 'memory' | 'skills' | 'review'
interface State { day: string; runs: Partial<Record<Ability, number>>; prompts: string[]; skillMark: number; reviewed: Record<string, string>; seen: string[] }

export const ABILITY_SETTINGS: Record<Ability, string> = { memory: 'proactive-memory', skills: 'proactive-skills', review: 'proactive-review' }
const FILE = 'comfyart/proactive.json'
const LOCK = 'comfyart-proactive'
const MAX_PROMPTS = 30
const SKILL_EVERY = 6
const MAX_SEEN = 50
const REVIEW_DELAY = 60000
const REVIEW_MIN_SHAPES = 3
const REVIEW_PX = 1024

const MEMORY_SYSTEM = 'From this exchange extract only durable decisions or preferences the user explicitly stated that help THIS project. Ignore assistant suggestions, project titles, one-off commands and already saved notes in the same scope. Only for an explicit cross-project preference, copy the preference verbatim into text and put the full user sentence in global_request. Otherwise omit global_request. Reply with JSON {"memories":[{"text":"a short note in the user’s language","category":"about|taste|work|assets"}]}; return an empty list if none.'
const SKILL_SYSTEM = 'You turn a designer\'s repeated way of working into a reusable skill for their design agent. You get their latest requests, numbered. If at least three of them follow the same workflow (same kind of deliverable, steps, format or style rules), write a skill for it; otherwise return null. Do not repeat an existing skill. Reply with ONE JSON object and nothing else: {"skill": null} or {"skill": {"name": "<short name in the user\'s language>", "instructions": "<step-by-step instructions for the agent, in English>", "samples": [<numbers of the requests it was learned from>]}}'
const REVIEW_SYSTEM = `You review a design canvas for a designer. The picture is cropped tightly around the content, so elements touching its edges are fine. Look for concrete problems: typos or garbled text in images, inconsistent colors or styles across a set, cut-off subjects inside an image, broken layouts, wrong aspect ratios, low-quality or deformed generations. Reply with ONE JSON object and nothing else: {"issues": ["<one problem and a fix, written in ${lang === 'zh' ? 'Simplified Chinese' : 'English'}>"]} (empty when nothing is wrong). At most 5 issues.`

const today = () => new Date().toLocaleDateString('sv')
const enabled = (a: Ability) => !!botEnabledAtom.get() && settingsAtom.get()[ABILITY_SETTINGS[a]] === true && (a !== 'memory' || settingsAtom.get()['memory-enabled'] !== false)
const dailyLimit = () => Number(settingsAtom.get()['proactive-daily']) || 0

async function withState<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  return navigator.locks.request(LOCK, async () => {
    const saved = await readUserJson<State>(FILE, { day: today(), runs: {}, prompts: [], skillMark: 0, reviewed: {}, seen: [] })
    const state = saved.day === today() ? saved : { ...saved, day: today(), runs: {} }
    const out = await fn(state)
    await writeUserJson(FILE, state)
    return out
  })
}

function take(state: State, a: Ability): boolean {
  if (!enabled(a) || (state.runs[a] ?? 0) >= dailyLimit()) return false
  state.runs[a] = (state.runs[a] ?? 0) + 1
  return true
}

export const runsToday = () => readUserJson<State | null>(FILE, null).then((s) => (s?.day === today() ? s.runs : {}))

async function exchange(chatId: string, messageId: string) {
  const res = await api(`/comfyart/bot/chats/${chatId}`)
  if (!res.ok) return null
  const { chat, messages } = await res.json() as { chat: { project: string }; messages: BotMessage[] }
  if (chat.project !== currentProject()) return null
  const reply = messages.find((m) => m.id === messageId)
  const user = messages.find((m) => m.id === reply?.parent_id)
  const text = (m?: BotMessage) => m?.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim() ?? ''
  if (user?.role !== 'user' || user.blocks.some(b => b.type === 'trigger')) return null
  return reply && user ? { user: text(user), reply: text(reply), source: user.id } : null
}

async function learnMemory(ex: { user: string; reply: string; source: string }) {
  const known = (await loadMemory()).map((m) => `- [${m.scope}] ${m.text}`).join('\n')
  const raw = await ask(`Already remembered:\n${known || '(nothing)'}\n\nUser: ${ex.user}\n\nAgent: ${ex.reply.slice(0, 2000)}`, MEMORY_SYSTEM, [])
  await remember(toInputs(parseJson(raw)?.memories), t('proactive.source'), 'project', ex.source)
}

async function evolveSkill(prompts: string[]) {
  const existing = (await loadSkills()).map((s) => s.name).join(', ')
  const raw = await ask(`Existing skills: ${existing}\n\nLatest requests:\n${prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}`, SKILL_SYSTEM, [])
  const skill = parseJson(raw)?.skill as { name?: string; instructions?: string; samples?: number[] } | null | undefined
  if (!skill?.name || !skill.instructions) return
  const samples = (skill.samples ?? []).map((n) => prompts[n - 1]).filter(Boolean)
  await saveSkill({ id: `learned-${slug(skill.name)}`, name: skill.name, instructions: skill.instructions, custom: true, learned: samples })
  await editMemory('skill', { text: skill.name, source: t('proactive.source') })
  await notify({ kind: 'suggestion', title: t('proactive.skillLearned', skill.name), body: t('proactive.learnedFrom', samples.length, samples.slice(0, 3).join(' / ')) })
}

async function onTurnDone(e: { chat_id: string; message_id: string; status: string }) {
  if (e.status !== 'done' || !botEnabledAtom.get()) return
  const ex = await exchange(e.chat_id, e.message_id)
  if (!ex?.user) return
  const plan = await withState((s) => {
    if (s.seen.includes(e.message_id)) return null
    s.seen = [e.message_id, ...s.seen].slice(0, MAX_SEEN)
    s.prompts = [...s.prompts, ex.user].slice(-MAX_PROMPTS)
    const memory = take(s, 'memory')
    const due = s.prompts.length - Math.min(s.skillMark, s.prompts.length) >= SKILL_EVERY
    const skills = due && take(s, 'skills') ? s.prompts.slice(-SKILL_EVERY * 2) : null
    if (skills) s.skillMark = s.prompts.length
    return { memory, skills }
  })
  if (plan?.memory) await learnMemory(ex)
  if (plan?.skills) await evolveSkill(plan.skills)
}

function layoutContext(editor: Editor, ids: Set<TLShapeId>) {
  return JSON.stringify(editor.getCurrentPageShapes().filter(shape => ids.has(shape.id)).map(shape => ({
    id: shape.id, parent: shape.parentId, type: shape.type,
    bounds: editor.getShapePageBounds(shape)?.toJson(),
    text: 'text' in shape.props ? shape.props.text : undefined,
    name: 'name' in shape.props ? shape.props.name : undefined,
  })))
}

async function review(editor: Editor, valid: () => boolean) {
  const book = inspectZine(editor)
  const guide = book && roadmapGuide(editor)
  if (book && (!guide || !guide.content || guide.step.status === 'deferred')) return
  const ids = book && guide ? guide.targets.filter(id => editor.getShape(id)) : [...editor.getCurrentPageShapeIds()]
  if (!book && ids.length < REVIEW_MIN_SHAPES) return
  const project = currentProject()
  const layout = [guide && guide.step.title, book && describeZine(book), layoutContext(editor, editor.getShapeAndDescendantIds(ids))].filter(Boolean).join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(layout))
  const sig = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  const go = await withState((s) => {
    if (s.reviewed[project] === sig || !take(s, 'review')) return false
    s.reviewed[project] = sig
    return true
  })
  if (!go || !valid()) return
  const bounds = Box.Common(ids.flatMap(id => editor.getShapePageBounds(id) ?? []))
  const { blob } = await exportImage(editor, ids, { format: 'png', background: true, scale: Math.min(1, REVIEW_PX / Math.max(bounds.w, bounds.h)) })
  const src = viewUrl(await uploadImage(blob, `review-${project}.png`))
  const issues = parseJson(await ask(book ? describeZine(book) : 'Review this canvas.', REVIEW_SYSTEM, [src], layout))?.issues
  if (valid() && Array.isArray(issues) && issues.length) await notify({ project, source: 'canvas_review', kind: 'suggestion', title: t('proactive.reviewTitle'), body: issues.map((x) => `• ${x}`).join('\n') })
}

export function startProactive(editor: Editor, onError: ErrorSink) {
  const fail = (e: unknown) => onError(errorText(e))
  const stop = onComfyEvent('comfyart-bot', (e: { event: string; chat_id: string; message_id: string; status: string }) => {
    if (e.event === 'turn_done') void onTurnDone(e).catch(fail)
  })
  let alive = true
  let timer = 0
  let last = ''
  let priorContent = 0
  let priorStep = ''
  const quiet = () => alive && enabled('review') && !chatsAtom.get().some(c => c.busy)
  const stopGuide = react('roadmap review after meaningful edits', () => {
    const guide = roadmapGuide(editor)
    const signature = guide?.signature ?? ''
    const reviewEnabled = enabled('review')
    const busy = chatsAtom.get().some(c => c.busy)
    if (busy || !reviewEnabled) { clearTimeout(timer); guideShown.set(null); last = ''; return }
    if (last === signature) return
    clearTimeout(timer)
    const removed = guide?.step.id === priorStep && guide.content < priorContent
    priorContent = guide?.content ?? 0
    priorStep = guide?.step.id ?? ''
    last = signature
    guideShown.set(null)
    if (guide?.content && ['cover', 'back_cover', 'spread'].includes(guide.step.type) && guide.step.status !== 'deferred') return
    if (!guide || removed || (!guide.photos.length && !guide.content && guide.step.type !== 'typography' && guide.step.status !== 'deferred')) return
    const turn = currentRoadmapTurn(editor)
    const valid = () => quiet() && turn === currentRoadmapTurn(editor) && roadmapGuide(editor)?.signature === signature
    timer = window.setTimeout(() => {
      if (!valid()) return
      void withState(async state => {
        const key = 'roadmap:' + currentProject()
        if (!valid()) return
        if (state.reviewed[key] === signature) { guideShown.set(signature); return }
        if (!take(state, 'review')) return
        state.reviewed[key] = signature
        guideShown.set(signature)
        await notify({ source: 'canvas_review', kind: 'suggestion', title: t('proactive.reviewTitle'),
          body: guide.text, action: 'zine-photos', guideSignature: signature })
      }).catch(fail)
    }, 1500)
  })
  const visualTimer = window.setTimeout(() => {
    if (!quiet()) return
    const signature = roadmapGuide(editor)?.signature
    const turn = currentRoadmapTurn(editor)
    const shapes = editor.getCurrentPageShapes()
    void review(editor, () => quiet() && turn === currentRoadmapTurn(editor) && roadmapGuide(editor)?.signature === signature
      && editor.getCurrentPageShapes().length === shapes.length && shapes.every(s => editor.getShape(s.id) === s)).catch(fail)
  }, REVIEW_DELAY)
  return () => { alive = false; stop(); stopGuide(); guideShown.set(null); clearTimeout(timer); clearTimeout(visualTimer) }
}

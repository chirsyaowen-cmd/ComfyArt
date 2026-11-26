import { atom, createShapeId, type Editor, type TLImageShape, type TLShape, type TLShapeId, type TLVideoShape } from 'tldraw'

import { importPhotos, isPhoto } from './photoImport'
import { beginRoadmapTurn, roadmap } from './roadmap'
import { getZinePages } from './zine'
import { commentTarget } from './actions'
import { botEnabledAtom, logDirect, sendMessage, type BotBlock } from './bot'
import { capRefs, createGenerator, generate, nearestRatio } from './generate'
import { DURATIONS, VIDEO_RATIOS } from './genOptions'
import { uploadImage, viewUrl, type RefKind } from './comfy'
import { fileSrc, placeMedia, toMedia, type ErrorSink } from './jobs'
import { describeItem, itemImages, linkedKit, type LibraryItem } from './library'
import { ask, ocrLines, parseJson, transcribeFile } from './llm'
import { AUDIO, AUDIO_SIZE, type AudioShape } from './shapes/EmbedShapes'
import { refFrameContents, refFrameOf, refLinkedOf } from './chatFrame'
import { modelOf } from './models'
import type { CommentShape } from './shapes/CommentShape'
import { GENERATOR, type GeneratorShape } from './shapes/GeneratorShape'
import type { Skill } from './skills'
import { t } from './i18n'

export type AgentMode = 'agent' | 'image' | 'video'

export const draftAtom = atom('agent draft', '')
export const extraRefsAtom = atom<TLShapeId[]>('agent refs', [])
export const agentModeAtom = atom<AgentMode>('agent mode', 'agent')
export const kitsAtom = atom<LibraryItem[]>('agent kits', [])

export type RefShape = TLImageShape | TLVideoShape | AudioShape
export interface ChatDoc { src: string; name: string }

export const docsAtom = atom<ChatDoc[]>('agent docs', [])
export const DOC_ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.json'
export const isRefShape = (s: TLShape): s is RefShape => s.type === 'image' || s.type === 'video' || s.type === AUDIO

export const srcOf = (editor: Editor, shape: RefShape): string | null => fileSrc(editor, shape)

export function refKindOf(shape: RefShape): RefKind {
  return shape.type === AUDIO ? 'audio' : shape.type
}

function mediaName(editor: Editor, shape: RefShape): string {
  if (shape.type === AUDIO) return shape.props.name
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  return (asset?.type === shape.type && asset.props.name) || ''
}

const REF_LONG = 512
const isDoc = (f: File) => DOC_ACCEPT.split(',').some((ext) => f.name.toLowerCase().endsWith(ext))

export async function uploadRefs(editor: Editor, files: File[]) {
  if (getZinePages(editor).length) {
    const photos = files.filter(isPhoto)
    if (photos.length) importPhotos(photos)
    files = files.filter(f => !isPhoto(f))
  }
  for (const f of files) {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : null
    if (!kind && !isDoc(f)) continue
    const ref = await uploadImage(f, f.name)
    if (!kind) {
      docsAtom.set([...docsAtom.get(), { src: viewUrl(ref), name: f.name }])
      continue
    }
    const center = editor.getViewportPageBounds().center
    let id: TLShapeId
    if (kind === 'audio') {
      id = createShapeId()
      editor.createShape({ id, type: AUDIO, x: center.x - AUDIO_SIZE[0] / 2, y: center.y - AUDIO_SIZE[1] / 2, props: { src: viewUrl(ref), name: f.name } })
    } else {
      const m = await toMedia(ref, kind)
      const w = Math.min(m.w, REF_LONG)
      id = placeMedia(editor, m, f.name, center.x - w / 2, center.y - w * m.h / m.w / 2, w)
    }
    extraRefsAtom.set([...extraRefsAtom.get().filter((x) => x !== id), id])
  }
}

export async function sendToAgent(editor: Editor, text: string, refs: RefShape[], skill: Skill | null, kits: LibraryItem[] = [], docs: ChatDoc[] = [], context = '', source?: 'schedule') {
  const roadmapTurn = beginRoadmapTurn(editor, source ?? 'chat')
  if (roadmapTurn) context += '\n[Project Roadmap revision ' + roadmap(editor).revision +
    '. Start this turn with get_canvas. It returns current project photos, book frames, progress derived from the live canvas, and recorded user decisions. Follow only this request. ' +
    'During reviews, honor an explicit keep_image_only choice until the user asks to add text. ' +
    'For a change of direction call update_roadmap first. Use action last for “封面最后做” (last creative step before review), defer for “跳过”, then start the requested step. ' +
    'Page typography is on request, after photo treatment and before optional embellishments. For a title, caption, diary or date: ' +
    'Use get_canvas first. For “这页” / “this page”, active_book_frame is the confirmed target at send time, even when blank or a previous turn used another page. Go directly to view_canvas(ids=[target frame(s)]). ' +
    'Preserve supplied copy exactly; when asked to write, draft from this page. Choose a readable font, size, color, frame-local x/y, width and alignment around the subject and negative space. ' +
    'Call add_text directly with frame and role. Put all requested boxes in one call using additional, e.g. a title plus a separate date. ' +
    'Use a date supplied in the request or project; if none is specified use today (' + new Date().toLocaleDateString('sv-SE') + ') for the edition date. ' +
    'After add_text succeeds, reply in the user’s language. The first box is selected for manual editing. If embellishment_cards is returned, briefly point to the optional choices already in chat. ' +
    'For an explicit Zine embellishment review, get_canvas, view_canvas(ids=[active_book_frame]) and call suggest_embellishments once. If a card was posted, say it is ready in one short sentence and leave the choices to the card. Skip optional stages on image-only pages. ' +
    'Compare actual thumbnails with view_canvas(photo_key) for visual choices. If pixels are unavailable, be clear about that. Use place_photo only when the user asks to place a photo, using the chosen frame and current frame_version.]'
  const linked = linkedKit(editor.getDocumentSettings().meta.brandKit)
  if (linked && !kits.some((k) => k.id === linked.id)) kits = [...kits, linked]
  const frame = refLinkedOf(editor) ? refFrameOf(editor) : null
  if (frame) {
    const { media, notes } = refFrameContents(editor, frame)
    const extra = media.filter((s): s is RefShape => isRefShape(s) && !refs.some((r) => r.id === s.id))
    const first = refs.length + 1
    const last = refs.length + extra.length
    const items = extra.length ? ` Attached ${first === last ? `item ${first} comes` : `items ${first}-${last} come`} from it.` : ''
    const said = notes.length ? ` Notes in it: ${notes.map((n) => `"${n}"`).join('; ')}.` : ''
    if (items || said) context = [context, `[Linked reference frame "${frame.props.name}" (${frame.id}): follow it as the reference for this work.${items}${said}]`].filter(Boolean).join('\n')
    refs = [...refs, ...extra]
  }
  const sent = await Promise.all(refs.map(async (r) => {
    const src = srcOf(editor, r)
    if (!src) return []
    const kind = refKindOf(r)
    const transcript = kind === 'audio' ? await transcribeFile(src).catch(() => '') : ''
    return [{ id: r.id, src, name: mediaName(editor, r), kind, ...(transcript ? { transcript } : {}) }]
  }))
  await sendMessage({
    text, source, roadmap_turn: roadmapTurn,
    refs: sent.flat(),
    docs,
    kits: kits.map((k) => ({ name: k.name, description: describeItem(k), images: itemImages(k) })),
    ...(skill ? { skill: skill.name } : {}),
    ...(context ? { context } : {}),
  })
}

export function commentNotes(editor: Editor, comments: CommentShape[]) {
  const images: TLImageShape[] = []
  const lines = comments.map((c) => {
    const text = `- ${c.props.text.trim()}`
    const target = commentTarget(editor, c)
    if (!target) return text
    if (!images.some((s) => s.id === target.shape.id)) images.push(target.shape)
    const r = target.region
    return `${text} [on ${target.shape.id}, region x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.w)} h=${Math.round(r.h)} of ${target.src.w}×${target.src.h} px]`
  })
  return { text: lines.join('\n'), images }
}

export function commentsToChat(editor: Editor, comments: CommentShape[]) {
  const { text, images } = commentNotes(editor, comments)
  draftAtom.set([draftAtom.get(), text].filter(Boolean).join('\n'))
  extraRefsAtom.set([...new Set([...extraRefsAtom.get(), ...images.map((s) => s.id)])])
}

export type DirectSettings = Partial<GeneratorShape['props']>
export const directSettingsAtom = atom<Record<'image' | 'video', DirectSettings>>('direct settings', { image: {}, video: {} })

export interface DirectRun { refs: RefShape[]; prompt: string; near?: TLShapeId }

const RESULT_GAP = 40

function startDirect(editor: Editor, run: DirectRun, video: boolean, onError: ErrorSink): BotBlock {
  const refs = run.refs.filter((r): r is TLImageShape => r.type === 'image')
  const settings = directSettingsAtom.get()[video ? 'video' : 'image']
  const picked = settings.ratio ?? (video ? VIDEO_RATIOS[0] : '1:1')
  const ratio = video && refs[0] ? nearestRatio(refs[0].props.w / refs[0].props.h, VIDEO_RATIOS) : picked
  const media = video && run.refs.some((r) => r.type !== 'image')
  const srcs = media ? capRefs(run.refs.flatMap((r) => srcOf(editor, r) ?? [])) : refs.flatMap((r) => srcOf(editor, r) ?? []).slice(0, video ? 1 : undefined)
  const near = run.near && editor.getShapePageBounds(run.near)
  const holder = createGenerator(editor, video, { ...settings, prompt: run.prompt, ratio }, false, near ? [near.x, near.maxY + RESULT_GAP] : undefined)
  if (srcs.length) editor.updateShape<GeneratorShape>({ id: holder, type: GENERATOR, meta: { refs: srcs, ...(media ? { videoMode: 'refs' } : {}) } })
  void generate(editor, editor.getShape<GeneratorShape>(holder)!, onError)
  const model = modelOf(editor.getShape<GeneratorShape>(holder)!.props.workflow)?.label
  return {
    type: 'task',
    label: t('agent.directLabel', video ? t('dock.videoGeneration') : t('dock.imageGeneration'), ratio),
    holder,
    detail: { tool: video ? 'generate_video' : 'generate_image', prompt: run.prompt, ...(model ? { model } : {}), params: { aspect_ratio: ratio, ...(srcs.length ? { references: srcs.length } : {}) } },
  }
}

export function eachRuns(refs: RefShape[], targets: RefShape[], promptFor: (runRefs: RefShape[]) => string): DirectRun[] {
  if (!targets.length) return [{ refs, prompt: promptFor(refs) }]
  return targets.map((target) => {
    const runRefs = refs.filter((r) => r === target || !targets.includes(r))
    return { refs: runRefs, prompt: promptFor(runRefs), near: target.id }
  })
}

export async function generateDirect(editor: Editor, text: string, runs: DirectRun[], video: boolean, onError: ErrorSink) {
  const blocks = runs.map((run) => startDirect(editor, run, video, onError))
  if (botEnabledAtom.get()) await logDirect(text, blocks)
}

export function eachLine(refs: RefShape[], targets: RefShape[]): string {
  const n = (list: RefShape[]) => list.map((r) => refs.indexOf(r) + 1).join(', ')
  const shared = refs.filter((r) => !targets.includes(r))
  return `[Do this separately for each of attached items ${n(targets)}: one result per item, placed next to it${shared.length ? `, reusing attached items ${n(shared)} in every result` : ''}.]`
}

const STORY_SYSTEM = `Split a video idea into a storyboard. Reply with ONE JSON object and nothing else: {"scenes": [{"prompt": "<detailed English shot description with camera motion and sound>", "duration": ${DURATIONS.join('|')}}]}. Use as many scenes as the idea needs and keep characters and style consistent.`

export async function planStoryboard(idea: string): Promise<{ prompt: string; duration: number }[]> {
  const scenes = parseJson(await ask(idea, STORY_SYSTEM, []))?.scenes
  if (!Array.isArray(scenes)) throw new Error(t('agent.smartStoryboardFailedPleaseTry'))
  return scenes.filter((s) => s?.prompt).map((s) => ({ prompt: String(s.prompt), duration: DURATIONS.includes(Number(s.duration)) ? Number(s.duration) : DURATIONS[0] }))
}

export async function extractText(editor: Editor, shape: TLImageShape): Promise<string> {
  const src = srcOf(editor, shape)
  if (!src) return ''
  return (await ocrLines(src)).join('\n')
}

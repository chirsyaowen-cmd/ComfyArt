import { createShapeId, type Editor, type TLFrameShape, type TLShape, type TLShapeId } from 'tldraw'

import { loadImage } from './adjust'
import { thumbUrl, viewUrl } from './comfy'
import { roadmap, roadmapSource, updateRoadmap, type RoadmapTurn } from './roadmap'
import { frameFacts, placeProjectPhoto, projectPhotos } from './roadmapPhotos'
import { activeZineIndex, focusZinePage, getZinePages } from './zine'
import { embellishmentPageStatus, makeEmbellishmentOffer } from './zineEmbellishments'
import { BUNDLED_FONTS, fontLabel } from './fonts'
import { bookFonts, chooseZineFont } from './zineFonts'
import { placeInChatFrame } from './chatFrame'
import { placeHtml } from './embeds'
import { genInfoOf } from './generate'
import { type ErrorSink, fileSrc, GAP, jobOf, mediaAsset } from './jobs'
import { describeItem, itemImages, libraryAtom, linkedKit } from './library'
import { buildSlides } from './slides'
import { exportImage } from './shapes/ArtboardShape'
import { COMMENT } from './shapes/CommentShape'
import { HTML, type HtmlShape } from './shapes/EmbedShapes'
import { GENERATOR, type GeneratorShape } from './shapes/GeneratorShape'
import { TEXT, type TextShape } from './shapes/TextShape'
import { VECTOR, type VectorShape } from './shapes/VectorShape'
import { loadSkills, saveSkill } from './skills'
import { t } from './i18n'
import { uuid } from './id'

export type Args = Record<string, any>
export type Handler = (editor: Editor, args: Args, onError: ErrorSink, chat: string, checkTask: () => void, turn?: RoadmapTurn) => unknown

const MAX_SHAPES = 300
const VIEW_MAX_PX = 1024
const PAGE_TEXT_CAP = 3000

export function shapeOf(editor: Editor, id: unknown): TLShape {
  const shape = typeof id === 'string' ? editor.getShape(id as TLShapeId) : undefined
  if (!shape) throw new Error(`no shape ${JSON.stringify(id)} — use ids from get_canvas`)
  return shape
}

function nameOf(editor: Editor, shape: TLShape): string {
  if (shape.type === 'frame') return (shape as TLFrameShape).props.name
  if (shape.type === TEXT) return (shape as TextShape).props.text.slice(0, 200)
  return mediaAsset(editor, shape)?.props.name || (shape.props as { name?: string }).name || ''
}

function describe(editor: Editor, shape: TLShape) {
  const b = editor.getShapePageBounds(shape)!
  const parent = editor.getShape(shape.parentId as TLShapeId)
  const gen = genInfoOf(shape)
  const job = jobOf(shape)
  const media = mediaAsset(editor, shape)
  return {
    id: shape.id,
    type: shape.type === GENERATOR ? (job ? 'generating' : 'generator') : shape.type,
    ...(typeof shape.meta.vectorcraft === 'string' ? { artwork: shape.meta.vectorcraft } : {}),
    name: nameOf(editor, shape) || undefined,
    x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h),
    ...(parent?.type === 'frame' ? { frame: parent.id } : {}),
    ...(media?.props.src ? { url: media.props.src, pixels: `${media.props.w}x${media.props.h}` } : fileSrc(editor, shape) ? { url: fileSrc(editor, shape) } : {}),
    ...(gen?.prompt ? { prompt: gen.prompt.slice(0, 300) } : {}),
    ...(shape.type === GENERATOR ? { prompt: (shape as GeneratorShape).props.prompt.slice(0, 300) } : {}),
    ...(typeof shape.meta.pageText === 'string' ? { page_text: shape.meta.pageText.slice(0, PAGE_TEXT_CAP) } : {}),
  }
}

function pageOf(editor: Editor, page: unknown) {
  if (!page) return editor.getCurrentPage()
  const found = editor.getPages().find((p) => p.id === page || p.name === page)
  if (!found) throw new Error(`no page ${JSON.stringify(page)}`)
  return found
}

function toPageShapes(editor: Editor, ids: TLShapeId[]) {
  return ids.map((id) => editor.getShape(id)!).filter(Boolean)
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function textProps(args: Args): Partial<TextShape['props']> {
  return {
    text: String(args.text ?? ''),
    ...(args.font_size ? { size: Number(args.font_size) } : {}),
    ...(args.color ? { color: String(args.color) } : {}),
    ...(args.font ? { font: String(args.font) } : {}),
    ...(args.align ? { align: String(args.align) } : {}),
    ...(args.width ? { w: Number(args.width), autoSize: false } : {}),
  }
}

export const LAYOUT_HANDLERS: Record<string, Handler> = {
  update_roadmap: (editor, args, _onError, chat, _check, turn) => {
    if (turn && !turn.inspected) throw new Error('Read get_canvas before updating the roadmap.')
    return updateRoadmap(editor, args.expected_revision, args.changes, chat ? roadmapSource(editor) : 'chat')
  },
  place_photo: (editor, args, _onError, _chat, checkTask) => placeProjectPhoto(editor, {
    frame: args.frame, frame_version: args.frame_version, expected_revision: args.expected_revision, fit: args.fit, photo_key: args.photo_key,
  }, checkTask),
  get_canvas: (editor, args, _onError, _chat, _check, turn) => {
    const page = pageOf(editor, args.page)
    const ids = [...editor.getPageShapeIds(page.id)]
    const shapes = toPageShapes(editor, ids).filter((s) => s.type !== COMMENT).slice(0, MAX_SHAPES).map((s) => describe(editor, s))
    const kit = linkedKit(editor.getDocumentSettings().meta.brandKit)
    const uploads = projectPhotos(editor)
    if (turn && page.id === editor.getCurrentPageId()) turn.inspected = true
    return {
      project: editor.getDocumentSettings().name || undefined,
      pages: editor.getPages().map((p) => ({ id: p.id, name: p.name, current: p.id === editor.getCurrentPageId() })),
      page: page.id,
      bundled_fonts: BUNDLED_FONTS.map(family => ({ family, name: fontLabel(family) })),
      ...(getZinePages(editor).length ? { roadmap: roadmap(editor),
        active_book_frame: turn?.frame ?? getZinePages(editor)[activeZineIndex(editor)], book_fonts: bookFonts(editor),
        book_frames: getZinePages(editor).filter(id => editor.getShape(id)?.type === 'frame').map(id => ({
          ...frameFacts(editor, id), embellishment: embellishmentPageStatus(editor, id),
        })),
        uploads: { batch: uploads.batch, photos: uploads.photos.map(({ key, name, state }) => ({ key, name, state })) } } : {}),
      shapes,
      truncated: ids.length > MAX_SHAPES || undefined,
      selection: editor.getSelectedShapeIds(),
      brand_kit: kit ? { id: kit.id, name: kit.name } : null,
    }
  },
  view_canvas: async (editor, args, _onError, _chat, _check, turn) => {
    if (args.photo_key) {
      const photo = projectPhotos(editor).photos.find(p => p.key === args.photo_key && p.state === 'ready')
      if (!photo) throw new Error('Unknown or unavailable project upload')
      const img = await loadImage(thumbUrl(viewUrl(photo.ref), 512))
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      return { photo_key: photo.key, name: photo.name, png: canvas.toDataURL('image/png').split(',')[1] }
    }
    const ids = Array.isArray(args.ids) && args.ids.length ? args.ids.map((id: string) => shapeOf(editor, id).id) : [...editor.getCurrentPageShapeIds()]
    if (!ids.length) throw new Error('the page is empty')
    const shapes = toPageShapes(editor, ids)
    const bounds = shapes.map((s) => editor.getShapePageBounds(s)!).reduce((a, b) => a.union(b))
    const maxPx = Math.min(2048, Number(args.max_px) || VIEW_MAX_PX)
    const viewed = turn?.inspected ? getZinePages(editor).filter(id => ids.includes(id)).map(id => frameFacts(editor, id)) : []
    const { blob, width, height } = await exportImage(editor, ids, { format: 'png', background: true, scale: Math.min(1, maxPx / Math.max(bounds.w, bounds.h)) })
    for (const frame of viewed) turn?.viewedFrames.set(frame.id, frame.frame_version)
    return { width, height, bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.w), height: Math.round(bounds.h) }, png: await blobBase64(blob) }
  },
  brand_kits: (editor) => {
    const linked = linkedKit(editor.getDocumentSettings().meta.brandKit)
    return {
      linked: linked?.id ?? null,
      items: libraryAtom.get().map((k) => ({ id: k.id, kind: k.kind, name: k.name, summary: describeItem(k), images: itemImages(k) })),
    }
  },
  place_html: (editor, args, _onError, chat) => {
    const id = placeHtml(editor, String(args.html), String(args.name ?? t('botCommands.webPage')))
    editor.updateShape<HtmlShape>({
      id, type: HTML,
      ...(args.x != null ? { x: Number(args.x) } : {}),
      ...(args.y != null ? { y: Number(args.y) } : {}),
      props: { ...(args.width ? { w: Number(args.width) } : {}), ...(args.height ? { h: Number(args.height) } : {}) },
    })
    if (chat && args.x == null && args.y == null) placeInChatFrame(editor, id, chat)
    return { id }
  },
  create_slides: (editor, args, onError) => {
    if (!Array.isArray(args.slides) || !args.slides.length) throw new Error('slides must be a non-empty array')
    const before = new Set(editor.getCurrentPageShapeIds())
    const ids = buildSlides(editor, String(args.title ?? t('botCommands.presentation')), args.slides.map((s: Args) => ({
      title: String(s.title ?? ''), bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [], image: s.image ? String(s.image) : undefined,
    })), onError)
    const frames = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id) && editor.getShape(id)?.type === 'frame')
    return { frames, ids, note: ids.length ? 'images are generating: call wait_generation with ids' : undefined }
  },
  add_text: async (editor, args, _onError, chat, checkTask, turn) => {
    const pages = getZinePages(editor)
    const frame = args.frame ? shapeOf(editor, args.frame) : undefined
    if (frame && frame.type !== 'frame') throw new Error('Expected a frame from get_canvas')
    const inBook = frame && pages.includes(frame.id)
    if (!inBook && (args.role || args.additional?.length || (chat && pages.length && !frame)))
      throw new Error('For Zine typography, pass the target book frame from get_canvas')
    if (!inBook) {
      const id = createShapeId()
      const center = editor.getViewportPageBounds().center
      editor.createShape<TextShape>({ id, type: TEXT, parentId: frame?.id,
        x: Number(args.x ?? (frame ? GAP : center.x)), y: Number(args.y ?? (frame ? GAP : center.y)), props: textProps(args) })
      return { id }
    }

    const plan = roadmap(editor)
    const step = plan.steps.find(s => s.type === 'typography' && s.targetFrameIds.includes(frame.id))
    if (!step) throw new Error('Missing page typography step. Read get_canvas again.')
    const items: Args[] = [args, ...(args.additional ?? [])]
    const versions = new Map<TLShapeId, string>()
    const shapes = await Promise.all(items.map(async item => {
      const parent = item.frame ? shapeOf(editor, item.frame) : frame
      if (parent.type !== 'frame' || !step.targetFrameIds.includes(parent.id)) throw new Error('Text must belong to the target page or spread')
      const version = frameFacts(editor, parent.id).frame_version
      if (turn && turn.viewedFrames.get(parent.id) !== version)
        throw new Error('Inspect the target with get_canvas, then view_canvas(ids=[frame]) before placing text.')
      versions.set(parent.id, version)
      if (typeof item.text !== 'string' || !item.text.trim()) throw new Error('Expected non-empty text')
      const role = item.role ?? 'body'
      const font = await chooseZineFont(item.text, role, item.font, bookFonts(editor, role))
      return { id: createShapeId(), type: TEXT, parentId: parent.id, x: Number(item.x ?? GAP), y: Number(item.y ?? GAP),
        meta: { textRole: role }, props: { ...textProps(item), font } } as const
    }))
    checkTask()
    if (roadmap(editor).revision !== plan.revision || [...versions].some(([id, version]) => frameFacts(editor, id).frame_version !== version))
      throw new Error('Target changed during placement. Read get_canvas and view_canvas again.')
    if (!editor.canCreateShapes(shapes)) throw new Error('Cannot create the requested text boxes')
    editor.run(() => {
      editor.createShapes(shapes)
      if (shapes.some(s => editor.getShape(s.id)?.parentId !== s.parentId)) throw new Error('Text placement failed')
      focusZinePage(editor, pages.indexOf(frame.id))
      editor.setCurrentTool('select').select(shapes[0].id)
      updateRoadmap(editor, plan.revision, [{ id: step.id, action: 'done' }], roadmapSource(editor))
    })
    for (const shape of shapes) turn?.placedText.add(shape.id)
    const embellishments = turn ? [...versions.keys()].flatMap(id => makeEmbellishmentOffer(editor, id) ?? []) : []
    return { id: shapes[0].id, embellishments, handoff: 'First layout complete. Reply now. The user has the text toolbar for further edits.', boxes: shapes.map(s => ({ id: s.id, frame: s.parentId, font: s.props.font })),
      completed_step: step.id, revision: roadmap(editor).revision }
  },
  suggest_embellishments: (editor, args, _onError, _chat, _check, turn) => {
    const frame = turn?.frame
    if (!frame || frame !== args.frame || turn.viewedFrames.get(frame) !== frameFacts(editor, frame).frame_version)
      throw new Error('Inspect active_book_frame with get_canvas and view_canvas before suggesting embellishments.')
    const offer = makeEmbellishmentOffer(editor, frame)
    return { embellishments: offer ? [offer] : [] }
  },
  add_shape: (editor, args) => {
    const kinds = ['rect', 'ellipse', 'polygon', 'star']
    if (!kinds.includes(args.kind)) throw new Error(`kind must be one of ${kinds.join(', ')}`)
    const id = createShapeId()
    const center = editor.getViewportPageBounds().center
    editor.createShape<VectorShape>({
      id, type: VECTOR, x: Number(args.x ?? center.x), y: Number(args.y ?? center.y),
      props: { kind: args.kind, w: Number(args.width) || 200, h: Number(args.height) || 200, ...(args.fill ? { fill: String(args.fill) } : {}), stroke: args.stroke ? String(args.stroke) : '', ...(args.sides ? { sides: Number(args.sides) } : {}) },
    })
    if (args.frame) {
      editor.reparentShapes([id], shapeOf(editor, args.frame).id)
      editor.updateShape({ id, type: VECTOR, x: Number(args.x ?? GAP), y: Number(args.y ?? GAP) })
    }
    return { id }
  },
  create_frame: (editor, args) => {
    const id = createShapeId()
    const w = Number(args.width) || 1080
    const h = Number(args.height) || 1080
    const center = editor.getViewportPageBounds().center
    editor.createShape<TLFrameShape>({ id, type: 'frame', x: Number(args.x ?? center.x - w / 2), y: Number(args.y ?? center.y - h / 2), props: { w, h, name: String(args.name ?? t('common.artboard')) } })
    if (Array.isArray(args.children) && args.children.length) editor.reparentShapes(args.children.map((c: string) => shapeOf(editor, c).id), id)
    return { id }
  },
  update_shapes: (editor, args) => {
    if (!Array.isArray(args.updates)) throw new Error('updates must be an array')
    const updated: string[] = []
    editor.run(() => {
      for (const u of args.updates as Args[]) {
        const shape = shapeOf(editor, u.id)
        if (u.frame !== undefined) editor.reparentShapes([shape.id], u.frame ? shapeOf(editor, u.frame).id : editor.getCurrentPageId())
        const current = editor.getShape(shape.id)!
        const point = u.x != null || u.y != null
          ? editor.getPointInParentSpace(shape.id, { x: Number(u.x ?? editor.getShapePageBounds(current)!.x), y: Number(u.y ?? editor.getShapePageBounds(current)!.y) })
          : null
        const props: Record<string, unknown> = {}
        if (u.width != null && 'w' in current.props) props.w = Number(u.width)
        if (u.height != null && 'h' in current.props) props.h = Number(u.height)
        if (u.name != null && current.type === 'frame') props.name = String(u.name)
        if (u.text != null && current.type === TEXT) Object.assign(props, { text: String(u.text), rich: null })
        if (u.color != null && current.type === TEXT) props.color = String(u.color)
        if (u.color != null && current.type === VECTOR) props.fill = String(u.color)
        editor.updateShape({
          id: shape.id, type: current.type,
          ...(point ? { x: point.x, y: point.y } : {}),
          ...(u.rotation != null ? { rotation: (Number(u.rotation) * Math.PI) / 180 } : {}),
          ...(u.opacity != null ? { opacity: Number(u.opacity) } : {}),
          ...(Object.keys(props).length ? { props } : {}),
        })
        updated.push(shape.id)
      }
    })
    return { updated }
  },
  delete_shapes: (editor, args) => {
    const ids = (args.ids ?? []).map((id: string) => shapeOf(editor, id).id)
    editor.deleteShapes(ids)
    return { deleted: ids }
  },
  focus: (editor, args) => {
    const shapes = (args.ids ?? []).map((id: string) => shapeOf(editor, id))
    const page = shapes[0] && editor.getAncestorPageId(shapes[0])
    if (page) editor.setCurrentPage(page)
    editor.select(...shapes.map((s: TLShape) => s.id))
    editor.zoomToSelection({ animation: { duration: 200 } })
    return { selected: shapes.map((s: TLShape) => s.id) }
  },
  skill: async (_editor, args) => {
    const skills = await loadSkills()
    if (args.action === 'list') return { skills: skills.map((s) => ({ name: s.name, description: s.instructions.slice(0, 200), custom: !!s.custom })) }
    if (args.action === 'save') {
      if (!args.name || !args.instructions) throw new Error('save needs name and instructions')
      const existing = skills.find((s) => s.custom && s.name === args.name)
      await saveSkill({ ...existing, id: existing?.id ?? uuid().slice(0, 8), name: String(args.name), instructions: String(args.instructions), custom: true })
      return { saved: args.name }
    }
    if (args.action !== 'read') throw new Error('action must be list, read or save')
    const skill = skills.find((s) => s.name === args.name)
    if (!skill) throw new Error(`unknown skill ${JSON.stringify(args.name)} — available: ${skills.map((s) => s.name).join(', ')}`)
    if (args.path) {
      const content = skill.files?.[args.path]
      if (content == null) throw new Error(`skill ${skill.name} has no file ${args.path}; files: ${Object.keys(skill.files ?? {}).join(', ') || '(none)'}`)
      return { name: skill.name, path: args.path, content }
    }
    return { name: skill.name, instructions: skill.instructions, files: Object.keys(skill.files ?? {}), images: Object.values(skill.images ?? {}) }
  },
}

import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useValue, type Editor, type TLAssetStore, type TLComponents, type TLEditorSnapshot, type TldrawOptions, type TLShape } from 'tldraw'
import 'tldraw/tldraw.css'

import { isViewUrl, thumbSize, thumbUrl, uploadImage, viewUrl } from './comfy'
import { svgRaster } from './vectorize'
import { errorText, resumeJobs } from './jobs'
import './layers'
import { defaultKitId, loadLibrary } from './library'
import { loadMemory } from './memory'
import { loadModels } from './models'
import { loadWorkflowConfig } from './customWorkflows'
import { NEW_PARAM } from './projects'
import { startAutosave } from './autosave'
import { takeHandoff } from './home/handoff'
import { markDark, themeAtom } from './theme'
import { overrides } from './overrides'
import { CommentShapeUtil, CommentTool } from './shapes/CommentShape'
import { AudioShapeUtil, HtmlShapeUtil, LottieShapeUtil, ModelShapeUtil } from './shapes/EmbedShapes'
import { DoodleShapeUtil, DoodleTool } from './shapes/DoodleShape'
import { GenBlockShapeUtil, QrShapeUtil } from './shapes/ComposeShapes'
import { TextShapeUtil, TextTool } from './shapes/TextShape'
import { PenTool } from './shapes/PenTool'
import { VectorShapeUtil, VectorTool } from './shapes/VectorShape'
import { ArtboardShapeUtil } from './shapes/ArtboardShape'
import { GeneratorShapeUtil } from './shapes/GeneratorShape'
import { MockupShapeUtil } from './shapes/MockupShape'
import { HoverVideoShapeUtil } from './shapes/VideoShape'
import { AdjustPanel } from './ui/AdjustPanel'
import { AgentPanel } from './ui/AgentPanel'
import { BatchRename } from './ui/BatchRename'
import { CanvasMenu } from './ui/CanvasMenu'
import { CanvasTools } from './ui/CanvasTools'
import { CommentPanel } from './ui/CommentPanel'
import { Confirm } from './ui/Confirm'
import { Dock } from './ui/Dock'
import { dropLibraryPhoto } from './assets'
import { DropHandlers } from './ui/DropHandlers'
import { ErrorToasts, reportError } from './ui/ErrorToasts'
import { EmbedToolbar, HtmlPreview } from './ui/EmbedToolbar'
import { Effects } from './ui/Effects'
import { HistoryDialog } from './ui/HistoryDialog'
import { AudioDialog } from './ui/AudioDialog'
import { ExportDialog } from './ui/ExportDialog'
import { MockupPanel } from './ui/MockupPanel'
import { PathEditor } from './ui/PathEditor'
import { FrameToolbar, registerFrameRules } from './ui/FrameToolbar'
import { EditLayers } from './ui/EditLayers'
import { GenPanel } from './ui/GenPanel'
import { CanvasPick } from './ui/CanvasPick'
import { CanvasChat } from './ui/CanvasChat'
import { CropBar } from './ui/CropBar'
import { ImageToolbar, registerCropRule } from './ui/ImageToolbar'
import { InfoDialog } from './ui/InfoDialog'
import { KitEditor } from './ui/KitEditor'
import { NoticeCenter } from './ui/NoticeCenter'
import { loadNotices } from './notices'
import { startScheduler } from './schedules'
import { trackProjectPhotos } from './roadmapPhotos'
import { trackRoadmap } from './roadmap'
import { startProactive } from './proactive'
import { startChatFrames } from './chatFrame'
import { ScheduleDialog } from './ui/ScheduleDialog'
import { startBot } from './bot'
import { registerCommandBus } from './botCommands'
import { BotSettings } from './ui/BotSettings'
import { TaskDetails } from './ui/TaskDetails'
import { InpaintPanel } from './ui/InpaintPanel'
import { SkillsDialog } from './ui/SkillsDialog'
import { Slideshow } from './ui/Slideshow'
import { SmudgePanel } from './ui/SmudgePanel'
import { Lightbox } from './ui/Lightbox'
import { MemoryDialog } from './ui/MemoryDialog'
import { WorkflowsDialog } from './ui/WorkflowsDialog'
import { ModePanel } from './ui/ModePanel'
import { MultiToolbar } from './ui/MultiToolbar'
import { ProjectHeader } from './ui/ProjectHeader'
import { SelectionLabel } from './ui/SelectionLabel'
import { Shortcuts } from './ui/Shortcuts'
import { StylePanel } from './ui/StylePanel'
import { SidePanel } from './ui/SidePanel'
import { ShapeToolbar, TextToolbar } from './ui/StyleToolbars'
import { TopBar } from './ui/TopBar'
import { VideoEditor } from './ui/VideoEditor'
import { VideoToolbar } from './ui/VideoToolbar'
import { Zoom } from './ui/Zoom'
import { lang, t } from './i18n'
import { createZine, focusZinePage, getZinePages, restoreZineLayout } from './zine'
import { ZineNavigation } from './ui/ZineNavigation'
import { uuid } from './id'

const CHANNEL = 'comfyart-projects'
const TAB = uuid()
const assetUrls = getAssetUrlsByImport()
const shapeUtils = [ArtboardShapeUtil, GeneratorShapeUtil, CommentShapeUtil, DoodleShapeUtil, TextShapeUtil, VectorShapeUtil, LottieShapeUtil, ModelShapeUtil, HtmlShapeUtil, AudioShapeUtil, MockupShapeUtil, GenBlockShapeUtil, QrShapeUtil, HoverVideoShapeUtil]
const tools = [CommentTool, DoodleTool, TextTool, VectorTool, PenTool]
const getShapeVisibility = (shape: TLShape) => (shape.meta.hidden ? 'hidden' as const : 'inherit' as const)

const components: TLComponents = {
  ContextMenu: CanvasMenu,
  Toolbar: null,
  StylePanel: null,
  MainMenu: null,
  PageMenu: null,
  NavigationPanel: null,
  HelpMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  ImageToolbar: null,
  VideoToolbar: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
  HelperButtons: null,
  DebugPanel: null,
  DebugMenu: null,
  Minimap: null,
}

const assets: TLAssetStore = {
  async upload(_asset, file) {
    const ref = await uploadImage(file, file.name || 'image.png')
    return { src: viewUrl(ref) }
  },
  resolve(asset, ctx) {
    const src = asset.props.src
    if (!src || ctx.shouldResolveToOriginal || asset.type !== 'image') return src
    if (asset.props.mimeType === 'image/svg+xml') return svgRaster(src, asset.props.w, asset.props.h, ctx.steppedScreenScale * ctx.dpr)
    const size = thumbSize(Math.max(asset.props.w, asset.props.h) * ctx.steppedScreenScale * ctx.dpr)
    return size && isViewUrl(src) && !asset.props.isAnimated ? thumbUrl(src, size) : src
  },
}

export function App({ id, snapshot }: { id: string; snapshot: TLEditorSnapshot | null }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const onDropOnCanvas = useCallback<NonNullable<TldrawOptions['experimental__onDropOnCanvas']>>(({ point, event }) => {
    const ed = editorRef.current
    return ed ? dropLibraryPhoto(ed, event.dataTransfer, point, e => reportError(errorText(e))) : false
  }, [])
  const setError = reportError
  const [stale, setStale] = useState(false)
  const staleRef = useRef(false)
  const dark = useValue('dark mode', () => editor?.user.getIsDarkMode() ?? false, [editor])

  useEffect(() => {
    if (editor) markDark(dark)
  }, [editor, dark])

  useEffect(() => {
    void Promise.all([loadMemory(), loadWorkflowConfig(), loadModels(), loadNotices()]).catch((e) => setError(String(e)))
  }, [])

  const onMount = useCallback((ed: Editor) => {
    ed.user.updateUserPreferences({ colorScheme: themeAtom.get(), locale: lang === 'zh' ? 'zh-cn' : 'en' })
    editorRef.current = ed
    setEditor(ed)
    restoreZineLayout(ed)
    if (getZinePages(ed).length) {
      ed.selectNone()
      focusZinePage(ed, 0)
    }
    const stopFrames = registerFrameRules(ed)
    const stopCrop = registerCropRule(ed)
    return () => { editorRef.current = null; stopFrames(); stopCrop() }
  }, [])

  useEffect(() => {
    if (!editor) return
    let alive = true
    let stopJobs = () => { }
    let stopScheduler = () => { }
    let stopRoadmap = () => { }
    let stopPhotos = () => { }
    let stopProactive = () => { }
    let stopChatFrames = () => { }
    let stopCommands = () => { }
    let stopAutosave = () => { }
    const stopBot = startBot(id, () => staleRef.current)
    loadLibrary()
      .then(() => {
        if (!alive) return
        const doc = editor.getDocumentSettings()
        const kit = new URL(location.href).searchParams.get('kit')
        if (!snapshot && !('brandKit' in doc.meta)) editor.updateDocumentSettings({ meta: { ...doc.meta, brandKit: kit ?? defaultKitId() } })
        const params = new URL(location.href).searchParams
        if (!snapshot && params.has(NEW_PARAM) && params.get('format') === 'zine') {
          createZine(editor)
          focusZinePage(editor, 0)
        }
        if (kit) {
          const url = new URL(location.href)
          url.searchParams.delete('kit')
          history.replaceState(null, '', url)
        }
        for (const page of editor.getPages()) {
          if (/^Page \d+$/.test(page.name)) editor.renamePage(page.id, page.name.replace('Page', t('app.page')))
        }
        const content = editor.getCurrentPageBounds()
        if (!getZinePages(editor).length && content) editor.zoomToBounds(content, { targetZoom: 1 })
        editor.clearHistory()
        stopJobs = resumeJobs(editor, setError)
        stopScheduler = startScheduler(editor, setError)
        stopProactive = startProactive(editor, setError)
        stopChatFrames = startChatFrames(editor)
        stopCommands = registerCommandBus(editor, id, () => staleRef.current, setError)
        const autosave = startAutosave(editor, id, () => !staleRef.current, () => channel.postMessage({ project: id, tab: TAB }))
        stopAutosave = autosave.stop
        stopRoadmap = trackRoadmap(editor)
        stopPhotos = trackProjectPhotos(editor)
        const url = new URL(location.href)
        if (url.searchParams.has(NEW_PARAM)) {
          void autosave.save()
          url.searchParams.delete(NEW_PARAM)
          url.searchParams.delete('format')
          history.replaceState(null, '', url)
        }
        takeHandoff(editor, setError).catch((e) => setError(errorText(e)))
      })
      .catch((e) => setError(String(e)))
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e: MessageEvent<{ project: string; tab: string }>) => {
      if (e.data.project !== id || e.data.tab === TAB) return
      staleRef.current = true
      setStale(true)
    }
    return () => {
      alive = false
      stopJobs()
      stopScheduler()
      stopRoadmap()
      stopPhotos()
      stopProactive()
      stopChatFrames()
      stopCommands()
      stopBot()
      channel.close()
      stopAutosave()
    }
  }, [editor, id, snapshot])

  return (
    <div className="ca-root">
      <div className="ca-main">
        {editor && (
          <TopBar
            editor={editor}
            left={
              <ProjectHeader editor={editor} projectId={id}>
                <NoticeCenter editor={editor} />
              </ProjectHeader>
            }
          />
        )}
        <div className="ca-body">
          {editor && <SidePanel editor={editor} left onError={setError} />}
          <div className="ca-canvas">
            <Tldraw
              options={{ experimental__onDropOnCanvas: onDropOnCanvas }}
              snapshot={snapshot ?? undefined}
              assets={assets}
              assetUrls={assetUrls}
              shapeUtils={shapeUtils}
              tools={tools}
              components={components}
              overrides={overrides}
              getShapeVisibility={getShapeVisibility}
              onMount={onMount}
            >
              <ErrorToasts />
              <DropHandlers onError={setError} />
              <ZineNavigation />
              <SelectionLabel />
              <EditLayers />
              <ImageToolbar onError={setError} />
              <CropBar />
              <MockupPanel onError={setError} />
              <PathEditor />
              <ModePanel onError={setError} />
              <AdjustPanel onError={setError} />
              <InpaintPanel onError={setError} />
              <SmudgePanel onError={setError} />
              <StylePanel onError={setError} />
              <Effects />
              <VideoToolbar />
              <GenPanel onError={setError} />
              <CanvasPick onError={setError} />
              <CanvasChat onError={setError} />
              <CommentPanel onError={setError} />
              <MultiToolbar onError={setError} />
              <TextToolbar onError={setError} />
              <ShapeToolbar />
              <FrameToolbar onError={setError} />
              <EmbedToolbar onError={setError} />
              <Dock onError={setError} />
              <CanvasTools zoom={<Zoom />} />
            </Tldraw>
            {editor && <AgentPanel editor={editor} onError={setError} />}
          </div>
          {editor && <SidePanel editor={editor} onError={setError} />}
        </div>
      </div>
      <Shortcuts />
      <KitEditor onError={setError} />
      <Confirm />
      {editor && <BatchRename editor={editor} />}
      {editor && <Lightbox editor={editor} />}
      {editor && <Slideshow editor={editor} />}
      <HtmlPreview />
      {editor && <InfoDialog editor={editor} onError={setError} />}
      {editor && <TaskDetails editor={editor} />}
      {editor && <ScheduleDialog editor={editor} onError={setError} />}
      <BotSettings onError={setError} />
      {editor && <VideoEditor editor={editor} onError={setError} />}
      <MemoryDialog onError={setError} />
      <WorkflowsDialog onError={setError} />
      <SkillsDialog onError={setError} />
      {editor && <HistoryDialog editor={editor} projectId={id} onError={setError} />}
      {editor && <ExportDialog editor={editor} onError={setError} />}
      {editor && <AudioDialog editor={editor} onError={setError} />}
      {stale && (
        <div className="ca-stale">
          <span>{t('app.yourFileVersionIsOut')}</span>
          <button type="button" className="ca-panel__primary" onClick={() => location.reload()}>{t('app.refresh')}</button>
        </div>
      )}
    </div>
  )
}

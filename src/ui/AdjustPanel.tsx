import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue, type TLImageShape } from 'tldraw'

import { adjustedCanvas, autoAdjust, loadImage, NO_ADJUST, type Adjust } from '../adjust'
import { adjustedOf, applyAdjust, sourceAsset } from '../imageOps'
import { errorText } from '../jobs'
import { PhotoRecipeControls } from './PhotoRecipeControls'
import { recipeOf, renderRecipe, needsFullPreview, type PhotoRecipe } from '../photoRecipe'
import { Icons } from './icons'
import { ColorPicker } from './ColorPicker'
import { exitMode, modeAtom } from './mode'
import { useElementSize, useSelectedImage, useSelectionRect } from './selection'
import { t } from '../i18n'
import { useEscape } from './escape'

const GAP = 12
const EDGE = 8
const PREVIEW_SIDE = 900

export interface Effects { shadow: { x: number; y: number; blur: number; color: string } | null; blur: number }
export const NO_EFFECTS: Effects = { shadow: null, blur: 0 }

const TABS: [string, [keyof Adjust, string, number][]][] = [
  [t('adjustPanel.light'), [['exposure', t('adjustPanel.exposure'), -100], ['contrast', t('adjustPanel.contrast'), -100], ['highlights', t('adjustPanel.highlights'), -100], ['shadows', t('adjustPanel.shadows'), -100], ['whites', t('adjustPanel.whites'), -100], ['blacks', t('adjustPanel.blacks'), -100]]],
  [t('common.color'), [['saturation', t('adjustPanel.saturation'), -100], ['vibrance', t('adjustPanel.vibrance'), -100], ['temperature', t('adjustPanel.temperature'), -100], ['tint', t('adjustPanel.tint'), -100]]],
  [t('adjustPanel.detail'), [['sharpen', t('adjustPanel.sharpen'), 0], ['clarity', t('adjustPanel.clarity'), -100], ['grain', t('adjustPanel.grain'), 0]]],
  [t('common.effects'), [['vignette', t('adjustPanel.vignette'), -100], ['bloom', t('adjustPanel.glow'), 0], ['glamour', t('adjustPanel.softLight'), 0]]],
]
const KEYS = TABS.flatMap(([, items]) => items.map(([k]) => k))

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="ca-panel__row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} />
      <span className="ca-panel__val">{value}</span>
    </label>
  )
}

export function effectsOf(shape: { meta: Record<string, unknown> }): Effects {
  return { ...NO_EFFECTS, ...(shape.meta.effects as Partial<Effects> | undefined) }
}

export function AdjustPanel({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const mode = useValue(modeAtom)
  const shape = useSelectedImage()
  const rect = useSelectionRect()
  const panel = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(panel, { w: 280, h: 300 })
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState(0)
  const [compare, setCompare] = useState(false)
  const editing = mode === 'adjust' || mode === 'photoAdjust'
  const photoTab = TABS.length
  const [recipe, setRecipe] = useState<PhotoRecipe>([])
  const active = editing || mode === 'effects'
  const src = shape ? sourceAsset(editor, shape)?.props.src : null

  useEffect(() => {
    setAdjust(shape ? { ...NO_ADJUST, ...adjustedOf(shape)?.adjust } : NO_ADJUST)
    setRecipe(shape ? recipeOf(shape) : [])
    setTab(mode === 'photoAdjust' ? photoTab : 0)
    setImg(null)
    if (!editing || !src) return
    let alive = true
    loadImage(src).then((i) => alive && setImg(i)).catch((e) => onError(String(e)))
    return () => { alive = false }
  }, [mode, src, shape?.id, shape?.props.assetId, onError])

  const crop = shape?.props.crop
  const flip = `${shape?.props.flipX ? -1 : 1},${shape?.props.flipY ? -1 : 1}`
  useEffect(() => {
    if (!img || !preview.current) return
    const controller = new AbortController()
    const draw = async () => {
      const base = adjustedCanvas(img, compare ? NO_ADJUST : adjust, !compare && needsFullPreview(recipe) ? Infinity : PREVIEW_SIDE)
      const out = compare ? base : await renderRecipe(base, recipe, controller.signal)
      if (controller.signal.aborted || !preview.current) return
      const [x0, y0, x1, y1] = crop ? [crop.topLeft.x, crop.topLeft.y, crop.bottomRight.x, crop.bottomRight.y] : [0, 0, 1, 1]
      const [sx, sy, sw, sh] = [x0 * out.width, y0 * out.height, (x1 - x0) * out.width, (y1 - y0) * out.height]
      const [fx, fy] = flip.split(',').map(Number)
      const c = preview.current
      c.width = Math.max(1, Math.round(sw))
      c.height = Math.max(1, Math.round(sh))
      const ctx = c.getContext('2d')!
      ctx.setTransform(fx, 0, 0, fy, fx < 0 ? c.width : 0, fy < 0 ? c.height : 0)
      ctx.drawImage(out, sx, sy, sw, sh, 0, 0, c.width, c.height)
    }
    const timer = window.setTimeout(() => void draw().catch(e => { if (!controller.signal.aborted) onError(errorText(e)) }), recipe.length && !compare ? 180 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [img, adjust, crop, flip, recipe, compare, onError])

  const dirty = !!shape && (KEYS.some(k => adjust[k] !== (adjustedOf(shape)?.adjust[k] ?? 0)) ||
    JSON.stringify(recipe) !== JSON.stringify(recipeOf(shape)))
  function close() {
    if (busy) return
    if (editing && tab === photoTab && dirty) void apply()
    else exitMode()
  }
  useEscape(active, close)

  useEffect(() => {
    if (active && !shape) exitMode()
  }, [active, shape])

  if (!active || !shape || !rect) return null
  const host = editor.getContainer().getBoundingClientRect()
  const left = rect.r + GAP + size.w > host.width - EDGE ? Math.max(EDGE, rect.l - size.w - GAP) : rect.r + GAP
  const top = Math.min(Math.max(rect.t, EDGE), host.height - size.h - EDGE)
  const effects = effectsOf(shape)
  const setEffects = (patch: Partial<Effects>) => editor.updateShape<TLImageShape>({ id: shape.id, type: 'image', meta: { ...shape.meta, effects: { ...effects, ...patch } as any } })

  async function apply() {
    if (!img || !shape) return
    setBusy(true)
    try {
      await applyAdjust(editor, shape, KEYS.some((k) => adjust[k]) ? adjust : null, () => adjustedCanvas(img, adjust), recipe)
      exitMode()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {editing && img && (
        <canvas ref={preview} className="ca-adjust__preview" style={{ left: rect.l, top: rect.t, width: rect.r - rect.l, height: rect.b - rect.t }} />
      )}
      <div ref={panel} className={'ca-panel' + (editing && tab === photoTab ? ' ca-photo-panel' : '')} style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="ca-panel__head"><span>{editing ? t('common.adjust') : t('common.effects')}</span><button className="ca-panel__icon" title={t('common.close')} disabled={busy} onClick={close}>{Icons.close}</button></div>
        {editing ? (
          <>
            <div className="ca-panel__chips">
              <button type="button" className="ca-panel__chip" data-on={tab === photoTab || undefined} onClick={() => setTab(photoTab)}>{t('photo.tools')}</button>
              {TABS.map(([label], i) => <button key={label} type="button" className="ca-panel__chip" data-on={tab === i || undefined} onClick={() => setTab(i)}>{label}</button>)}
            </div>
            {tab === photoTab ? <PhotoRecipeControls recipe={recipe} change={setRecipe} /> : TABS[tab][1].map(([key, label, min]) => (
              <Slider key={key} label={label} value={adjust[key]} min={min} max={100} onChange={(v) => setAdjust({ ...adjust, [key]: v })} />
            ))}
            <div className="ca-panel__chips">
              {tab !== photoTab && <button type="button" className="ca-panel__chip" disabled={!img} onClick={() => img && setAdjust({ ...adjust, ...autoAdjust(img) })}>{t('common.auto')}</button>}
              <button
                type="button"
                className="ca-panel__chip"
                onPointerDown={() => setCompare(true)}
                onPointerUp={() => setCompare(false)}
                onPointerLeave={() => setCompare(false)}
              >
                {t('adjustPanel.holdToCompare')}
              </button>
            </div>
          </>
        ) : (
          <>
            <Slider label={t('adjustPanel.opacity')} value={Math.round(shape.opacity * 100)} min={0} max={100} onChange={(v) => editor.updateShape({ id: shape.id, type: 'image', opacity: v / 100 })} />
            <Slider label={t('adjustPanel.layerBlur')} value={effects.blur} min={0} max={50} onChange={(v) => setEffects({ blur: v })} />
            <label className="ca-panel__row">
              <span>{t('adjustPanel.shadows')}</span>
              <input type="checkbox" checked={!!effects.shadow} onChange={(e) => setEffects({ shadow: e.target.checked ? { x: 0, y: 12, blur: 24, color: '#00000066' } : null })} />
              {effects.shadow && <ColorPicker value={effects.shadow.color.slice(0, 7)} title={t('adjustPanel.shadowColor')} onChange={(c) => c && setEffects({ shadow: { ...effects.shadow!, color: `${c}66` } })} />}
            </label>
            {effects.shadow && (
              <>
                <Slider label={t('adjustPanel.xOffset')} value={effects.shadow.x} min={-100} max={100} onChange={(v) => setEffects({ shadow: { ...effects.shadow!, x: v } })} />
                <Slider label={t('adjustPanel.yOffset')} value={effects.shadow.y} min={-100} max={100} onChange={(v) => setEffects({ shadow: { ...effects.shadow!, y: v } })} />
                <Slider label={t('adjustPanel.radius')} value={effects.shadow.blur} min={0} max={100} onChange={(v) => setEffects({ shadow: { ...effects.shadow!, blur: v } })} />
              </>
            )}
          </>
        )}
        <div className="ca-panel__foot">
          {editing ? (
            <>
              <button type="button" className="ca-panel__secondary" onClick={() => { setAdjust(NO_ADJUST); setRecipe([]) }}>{t('adjustPanel.reset')}</button>
              <button type="button" className="ca-panel__primary" disabled={busy || !img} onClick={() => dirty ? void apply() : exitMode()}>{busy ? t('adjustPanel.processing') : (tab === photoTab || !dirty ? t('common.done') : t('adjustPanel.apply'))}</button>
            </>
          ) : (
            <button type="button" className="ca-panel__primary" onClick={exitMode}>{t('common.done')}</button>
          )}
        </div>
      </div>
    </>
  )
}

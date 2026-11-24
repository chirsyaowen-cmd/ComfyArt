import operations from '../api/photo_operations.json'
import { api } from './comfy'
import { canvasBlob } from './canvasBlob'
import type { TLImageShape } from 'tldraw'

export { operations }
export type PhotoControl = keyof typeof operations
export const photoControls = Object.keys(operations) as PhotoControl[]
export const needsFullPreview = (recipe: PhotoRecipe) => recipe.some(s => s.kind !== 'gradientMap' && !operations[s.kind].command.startsWith('layer.'))
export type PhotoStep = { kind: PhotoControl; value: number }
  | { kind: 'gradientMap'; stops: { position: number; color: string }[] }
export type PhotoRecipe = PhotoStep[]
export const gradientStep = (): PhotoStep => ({ kind: 'gradientMap', stops: [
  { position: 0, color: '#172f27' }, { position: 1, color: '#c9d7c8' },
] })
export const recipeOf = (shape: TLImageShape): PhotoRecipe =>
  (shape.meta.photoRecipe as PhotoRecipe | undefined) ?? []

export async function renderRecipe(canvas: HTMLCanvasElement, recipe: PhotoRecipe, signal?: AbortSignal) {
  if (!recipe.length) return canvas
  const res = await api('/comfyart/photo_adjust', { method: 'POST', signal,
    headers: { 'Content-Type': 'image/png', 'X-Photo-Recipe': JSON.stringify(recipe) }, body: await canvasBlob(canvas) })
  if (!res.ok) throw new Error((await res.json()).error || 'PhotoCraft rendering failed')
  const pixels = await createImageBitmap(await res.blob())
  try {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(pixels, 0, 0)
  } finally { pixels.close() }
  return canvas
}

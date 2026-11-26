import type { Editor } from 'tldraw'
import { CHINESE_BRUSH, CHINESE_SANS, CHINESE_SERIF } from './fonts'
import { linkedKit } from './library'
import { TEXT } from './shapes/TextShape'
import { getZinePages } from './zine'
import coverageProbe from './assets/coverage-probe.ttf?url'

const latin = {
  title: ['Georgia', 'Arial'], body: ['Georgia', 'Times New Roman'], caption: ['Arial', 'Verdana'],
  date: ['Courier New', 'Arial'], note: ['Bradley Hand', 'Segoe Print', 'Georgia'],
}
export type TextRole = keyof typeof latin
const chinese: Record<TextRole, string[]> = {
  title: [CHINESE_SERIF, CHINESE_SANS, 'Songti SC', 'SimSun', 'Noto Serif CJK SC'],
  body: [CHINESE_SERIF, CHINESE_SANS, 'Songti SC', 'SimSun', 'Noto Serif CJK SC'],
  date: [CHINESE_SANS, 'PingFang SC', 'Microsoft YaHei'], caption: [CHINESE_SANS, 'PingFang SC', 'Microsoft YaHei'],
  note: [CHINESE_BRUSH, CHINESE_SANS, 'Kaiti SC', 'KaiTi', 'STKaiti'],
}

export function bookFonts(editor: Editor, role?: TextRole) {
  const sameRole = new Set<string>()
  const fonts = new Set<string>()
  for (const id of editor.getShapeAndDescendantIds(getZinePages(editor))) {
    const shape = editor.getShape(id)
    if (shape?.type === TEXT) {
      fonts.add(shape.props.font)
      if (role && shape.meta.textRole === role) sameRole.add(shape.props.font)
    }
  }
  const kit = linkedKit(editor.getDocumentSettings().meta.brandKit)
  for (const f of kit?.fonts ?? []) fonts.add(f)
  for (const f of kit?.fontFiles ?? []) fonts.add(f.family)
  return [...new Set([...sameRole, ...fonts])]
}

let probe: Promise<FontFace> | undefined
async function coverageContext() {
  // The probe maps every Unicode scalar to one empty glyph with a four-em advance.
  // If the selected face lacks a character, this explicit fallback makes it measurable.
  probe ??= new FontFace('ComfyArtProbe', 'url("' + coverageProbe + '")').load().then(face => {
    document.fonts.add(face)
    return face
  }).catch(error => { probe = undefined; throw error })
  await probe
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('Cannot check font coverage')
  ctx.font = '16px ComfyArtProbe'
  if (ctx.measureText('字').width !== 64) throw new Error('Font coverage probe unavailable')
  return ctx
}

export async function chooseZineFont(text: string, role: TextRole, preferred: unknown, book: string[]) {
  if (!Object.hasOwn(latin, role)) throw new Error('Expected a title, body, date, caption or note role')
  const chars = [...new Set(text)].filter(c => !/[\p{Cc}\p{Cf}\p{Variation_Selector}]/u.test(c))
  const cjk = /\p{Script=Han}/u.test(text)
  const regional = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? ['Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP']
    : /\p{Script=Hangul}/u.test(text) ? ['Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR']
    : cjk ? [...chinese[role], 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Hiragino Sans GB'] : []
  const candidates = new Set([...book, ...(typeof preferred === 'string' ? [preferred] : []), ...regional, ...latin[role]])
  const ctx = await coverageContext()
  for (const family of candidates) {
    const font = '16px "' + CSS.escape(family) + '"'
    await document.fonts.load(font, text)
    ctx.font = font + ', ComfyArtProbe'
    if (chars.every(c => ctx.measureText(c).width !== 64)) return family
  }
  throw new Error('No available font covers this text. Choose another installed or project font.')
}

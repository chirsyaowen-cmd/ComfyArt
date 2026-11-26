import { atom } from 'tldraw'
import { t } from './i18n'

export const CHINESE_SANS = 'Noto Sans SC'
export const CHINESE_SERIF = 'Noto Serif SC'
export const CHINESE_BRUSH = 'Ma Shan Zheng'

const bundledFontLabels = new Map([
  [CHINESE_SANS, 'fontPicker.notoSansSC'],
  [CHINESE_SERIF, 'fontPicker.notoSerifSC'],
  [CHINESE_BRUSH, 'fontPicker.maShanZheng'],
])

export const BUNDLED_FONTS = [...bundledFontLabels.keys()]

export function fontLabel(family: string) {
  const key = bundledFontLabels.get(family)
  return key ? t(key) : family
}

export function canvasFontFamily(value: string) {
  const family = value.replace(/^"(.*)"$/, '$1')
  if (!bundledFontLabels.has(family)) return value
  return family === CHINESE_SANS ? `"${family}", sans-serif` : `"${family}", "${CHINESE_SANS}", sans-serif`
}

export const COMMON_FONTS = ['Arial', 'Helvetica', 'Inter', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Microsoft YaHei', 'PingFang SC', 'SimHei', 'SimSun', 'KaiTi', 'FangSong']

type QueryLocalFonts = () => Promise<{ family: string }[]>
const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts

export const canLoadLocalFonts = !!query
export const localFontsAtom = atom<string[] | null>('local fonts', null)

export async function loadLocalFonts() {
  const families = [...new Set((await query!()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  localFontsAtom.set(families)
}

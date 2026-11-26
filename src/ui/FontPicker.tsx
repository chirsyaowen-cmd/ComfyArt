import { useEffect, useRef, useState } from 'react'
import { useValue } from 'tldraw'

import { BUNDLED_FONTS, canLoadLocalFonts, COMMON_FONTS, fontLabel, loadLocalFonts, localFontsAtom } from '../fonts'
import { Chips } from './Chips'
import { t } from '../i18n'
import { errorText } from '../jobs'
import { brandFonts } from '../library'
import { Icons } from './icons'
import { isEnter } from './keys'

type Source = 'all' | 'bundled' | 'brand' | 'common' | 'local'
const SOURCES: [Source, string][] = [['all', t('fontPicker.all')], ['bundled', t('fontPicker.bundled')], ['brand', t('fontPicker.brand')], ['common', t('fontPicker.common')], ['local', t('fontPicker.local')]]
const SHOWN = 200

export function FontPicker({ value, multiple, onPick, onCancel, onError }: {
  value: string[]
  multiple?: boolean
  onPick: (fonts: string[]) => void
  onCancel?: () => void
  onError: (msg: string) => void
}) {
  const brand = useValue('brand fonts', brandFonts, [])
  const local = useValue(localFontsAtom)
  const [source, setSource] = useState<Source>('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => search.current?.focus(), [])

  const lists: Record<Exclude<Source, 'all'>, string[]> = { bundled: BUNDLED_FONTS, brand, common: COMMON_FONTS, local: local ?? [] }
  const pool = source === 'all' ? [...new Set(Object.values(lists).flat())] : lists[source]
  const needle = q.trim().toLowerCase()
  const aliases = (f: string) => [f.toLowerCase(), fontLabel(f).toLowerCase()]
  const matches = needle ? pool.filter((f) => aliases(f).some(name => name.includes(needle))) : pool
  const exact = matches.find((f) => aliases(f).includes(needle))
  const custom = source !== 'bundled' && needle && !exact ? q.trim() : null
  const choose = (f: string) => {
    if (!multiple) return onPick([f])
    setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))
  }
  const loadLocal = async () => {
    setLoading(true)
    try { await loadLocalFonts(); setSource('local') } catch (e) { onError(errorText(e)) } finally { setLoading(false) }
  }

  return (
    <div className="ca-menu ca-fonts">
      <label className="ca-fonts__search">
        <span className="ca-icon">{Icons.search}</span>
        <input ref={search} value={q} placeholder={t('assetPicker.search')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation()
          const font = exact ?? matches.find((f) => BUNDLED_FONTS.includes(f)) ?? custom ?? matches[0]
          if (isEnter(e) && font) choose(font)
        }} />
      </label>
      <Chips value={source} options={SOURCES} onPick={setSource} />
      <div className="ca-fonts__list">
        {custom && <button type="button" className="ca-menu__item" onClick={() => choose(custom)}><span className="ca-menu__grow">{t('fontPicker.useName', custom)}</span>{picked.includes(custom) && <span className="ca-icon">{Icons.check}</span>}</button>}
        {matches.slice(0, SHOWN).map((f) => (
          <button key={f} type="button" className="ca-menu__item ca-fonts__item" onClick={() => choose(f)}>
            {BUNDLED_FONTS.includes(f) ? <>
              <span className="ca-menu__grow ca-fonts__name">{fontLabel(f)}</span>
              <span className="ca-fonts__sample" style={{ fontFamily: `"${f} Preview"` }}>{t('fontPicker.sample')}</span>
            </> : <span className="ca-menu__grow" style={{ fontFamily: `"${f}"` }}>{f}</span>}
            {(multiple ? picked.includes(f) : value.includes(f)) && <span className="ca-icon">{Icons.check}</span>}
          </button>
        ))}
        {matches.length > SHOWN && <div className="ca-menu__empty">{t('fontPicker.more', matches.length - SHOWN)}</div>}
        {!matches.length && !custom && <div className="ca-menu__empty">{source === 'brand' ? t('fontPicker.noBrandFonts') : t('fontPicker.noMatch')}</div>}
        {canLoadLocalFonts && !local && (source === 'all' || source === 'local') && (
          <button type="button" className="ca-menu__item" disabled={loading} onClick={() => void loadLocal()}><span className="ca-icon">{Icons.textTool}</span><span className="ca-menu__grow">{t('fontPicker.loadLocal')}</span></button>
        )}
      </div>
      {multiple && (
        <div className="ca-panel__foot">
          <button type="button" className="ca-panel__secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="ca-panel__primary" disabled={!picked.length} onClick={() => onPick(picked)}>{t('common.add')}</button>
        </div>
      )}
    </div>
  )
}

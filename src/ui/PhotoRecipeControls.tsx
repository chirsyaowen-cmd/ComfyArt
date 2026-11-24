import { t } from '../i18n'
import { gradientStep, operations, photoControls, type PhotoRecipe, type PhotoStep } from '../photoRecipe'

export function PhotoRecipeControls({ recipe, change }: { recipe: PhotoRecipe; change: (v: PhotoRecipe) => void }) {
  const replace = (i: number, step: PhotoStep) => change(recipe.map((s, n) => n === i ? step : s))
  return <div className="ca-photo-recipe">
    {recipe.map((step, i) => <div key={step.kind}>
      <div className="ca-photo-recipe__heading"><strong>{t('photo.' + step.kind)}</strong>
        <button type="button" className="ca-panel__chip" onClick={() => change(recipe.filter((_, n) => n !== i))}>{t('photo.remove')}</button>
      </div>
      {step.kind === 'gradientMap' ? <><div className="ca-photo-recipe__ramp" style={{ background: 'linear-gradient(to right, ' +
        step.stops.map(s => s.color + ' ' + s.position * 100 + '%').join(', ') + ')' }} />{step.stops.map((stop, n) => <div key={n}><label className="ca-photo-recipe__color">
        <span>{n === 0 ? t('photo.dark') : n === step.stops.length - 1 ? t('photo.light') : Math.round(stop.position * 100) + '%'}</span>
        <input type="color" value={stop.color} onChange={e => replace(i, { ...step, stops: step.stops.map((s, j) =>
          j === n ? { ...s, color: e.target.value } : s) })} />
      </label>
      {n > 0 && n < step.stops.length - 1 && <input aria-label={t('photo.position')} type="range" step="any"
        min={step.stops[n - 1].position} max={step.stops[n + 1].position} value={stop.position}
        onChange={e => {
          const position = Number(e.target.value)
          if (position > step.stops[n - 1].position && position < step.stops[n + 1].position)
            replace(i, { ...step, stops: step.stops.map((s, j) => j === n ? { ...s, position } : s) })
        }} />}
      </div>)}</> : <label className="ca-photo-recipe__slider"><input aria-label={t('photo.' + step.kind)} type="range" min={operations[step.kind].min} max={operations[step.kind].max}
        value={step.value} onChange={e => replace(i, { ...step, value: Number(e.target.value) })} /><span>{step.value}</span></label>}
    </div>)}
    <select aria-label={t('photo.add')} value="" onChange={e => {
      const kind = e.target.value
      if (kind === 'gradientMap') change([...recipe, gradientStep()])
      else {
        const control = photoControls.find(k => k === kind)
        if (control) change([...recipe, { kind: control, value: operations[control].initial }])
      }
    }}>
      <option value="">{t('photo.add')}…</option>
      {['gradientMap', ...photoControls].filter(k => !recipe.some(s => s.kind === k)).map(k =>
        <option key={k} value={k}>{t('photo.' + k)}</option>)}
    </select>
  </div>
}

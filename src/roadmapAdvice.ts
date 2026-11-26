export type AdviceOption =
  | { label: string; kind: 'request'; request: string }
  | { label: string; kind: 'dismiss' }

export interface RoadmapAdvice {
  text: string
  options: AdviceOption[]
}

export function parseRoadmapAdvice(value: unknown): RoadmapAdvice | null {
  if (!value || typeof value !== 'object' || !('suggestion' in value)) {
    throw new Error('Invalid canvas review response')
  }
  const suggestion = value.suggestion
  if (suggestion === null) return null
  if (!suggestion || typeof suggestion !== 'object' || !('text' in suggestion) ||
    typeof suggestion.text !== 'string' || !suggestion.text.trim() ||
    !('options' in suggestion) || !Array.isArray(suggestion.options) ||
    suggestion.options.length < 1 || suggestion.options.length > 3) {
    throw new Error('Invalid canvas review suggestion')
  }
  const options = suggestion.options.map((option: unknown): AdviceOption => {
    if (!option || typeof option !== 'object' || !('label' in option) ||
      typeof option.label !== 'string' || !option.label.trim() || !('kind' in option)) {
      throw new Error('Invalid canvas review option')
    }
    const label = option.label.trim()
    if (option.kind === 'dismiss') return { label, kind: 'dismiss' }
    if (option.kind === 'request' && 'request' in option && typeof option.request === 'string' && option.request.trim()) {
      return { label, kind: 'request', request: option.request.trim() }
    }
    throw new Error('Invalid canvas review option')
  })
  return { text: suggestion.text.trim(), options }
}

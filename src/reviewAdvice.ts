export type AdviceOption =
  | { label: string; kind: 'request'; request: string }
  | { label: string; kind: 'upload_photos' }
  | { label: string; kind: 'dismiss' }

export interface ReviewAdvice {
  text: string
  options: AdviceOption[]
}

export function parseReviewAdvice(value: unknown): ReviewAdvice | null {
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
    if (option.kind === 'dismiss' || option.kind === 'upload_photos') return { label, kind: option.kind }
    if (option.kind === 'request' && 'request' in option && typeof option.request === 'string' && option.request.trim()) {
      return { label, kind: 'request', request: option.request.trim() }
    }
    throw new Error('Invalid canvas review option')
  })
  return { text: suggestion.text.trim(), options }
}

export const PHOTO_REVIEW_INSTRUCTION = 'When the canvas or target page is blank, consider whether importing personal photos would serve the user’s creative goal. If so, offer {"kind":"upload_photos","label":"从设备选照片"} (English: "Choose photos from device"). This opens a file chooser directly and needs no request. You may omit it, for example for a text-only project.'

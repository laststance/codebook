import { STATIC_PAGE_REFUSAL_TEXT_MAX_CHARS } from '../constants'

/**
 * Cuts page-controlled text to one short line before it enters a refusal, a status line or a refusal's details.
 *
 * Why it exists: a page chooses its own `src`, `href`, specifier and file names, so unbounded text with line breaks would flood or forge the lines an agent reads. Called by the static-page refusal builders and the readiness `missing` wording.
 * @param text - The text as the page wrote it.
 * @returns At most {@link STATIC_PAGE_REFUSAL_TEXT_MAX_CHARS} characters, each line break replaced by a space.
 * @example
 * boundStaticPageText('a\nb') // => 'a b'
 */
export function boundStaticPageText(text: string): string {
  return text
    .slice(0, STATIC_PAGE_REFUSAL_TEXT_MAX_CHARS)
    .replaceAll(/[\r\n]/g, ' ')
}

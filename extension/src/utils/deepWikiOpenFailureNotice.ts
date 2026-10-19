import { WikiPathRefusedError } from './wikiPathRefusedError'
import { withFinalPeriod } from './withFinalPeriod'

/**
 * Keeps a path refusal's repair step intact when {@link activate} reports an Open DeepWiki failure.
 * @param error - The failure caught while opening the reader or its browser.
 * @returns The complete notice, with the refusal's own repair step or guidance to generate a missing Wiki; a reason that already ends with a full stop keeps that one.
 * @example
 * deepWikiOpenFailureNotice(new Error('Missing manifest'))
 * // => 'Codebook could not open DeepWiki: Error: Missing manifest. Generate it through /codebook in this project, then retry.'
 */
export function deepWikiOpenFailureNotice(error: unknown): string {
  // A path refusal already names its next step; other failures need generation guidance, after one full stop that ends the reason.
  return error instanceof WikiPathRefusedError
    ? `Codebook could not open DeepWiki: ${error.message}`
    : `Codebook could not open DeepWiki: ${withFinalPeriod(String(error))} Generate it through /codebook in this project, then retry.`
}

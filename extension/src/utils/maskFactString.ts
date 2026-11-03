import { redactSecretText } from './redactSecretText'
import { redactValuePreview } from './redactValuePreview'
import { maskBareShape } from './secretShapes'

/**
 * Masks one string a fact keeps: a whole Cookie header or Authorization value, the secret query values of a URL, the credential shapes inside a debugger's value preview, and the secrets of {@link redactSecretText}.
 * Why: a string fact is either a debugger's value preview (`'sid=abc; theme=dark'`, quotes included) or a bare page value (`sid=abc; theme=dark`), and the redaction contract hides a credential in both; called by {@link redactInspectedValue} when a fact is captured and by {@link maskSavedFacts} when a saved fact is served, so a study saved before the shape rules serves what a new capture would save.
 * @param text - The fact's string.
 * @returns The text with every such value replaced by {@link REDACTION_MASK}; a Cookie-shaped or Authorization-shaped string becomes the mask whole, a URL keeps everything but its secret query values, and any other string is unchanged.
 * @example
 * maskFactString('sid=abc; theme=dark') // => '[masked]'
 * maskFactString("'sid=abc; theme=dark'") // => '[masked]'
 * maskFactString('https://shop.test/cb?code=abc&page=2') // => 'https://shop.test/cb?code=[masked]&page=2'
 * maskFactString('theme=dark') // => 'theme=dark'
 */
export function maskFactString(text: string): string {
  return redactSecretText(redactValuePreview(maskBareShape(text)))
}

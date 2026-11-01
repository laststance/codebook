import { chromeVersionOf } from './chromeVersionOf'

/**
 * Reads the major version out of Chrome's own spelling of its version.
 *
 * It exists so the saved-session setup (which records the major of the Chrome that set a profile up) and the admission of a saved-session run (which compares it) read a version the way the owned launch does: the major comes from {@link chromeVersionOf}, the parse {@link assertSupportedChromeVersion} uses too.
 * Called by the saved-session setup and by the saved-session profile's run admission.
 *
 * @param versionText - Chrome's spelling: `Google Chrome 156.0.8078.74`, `Chromium 156.0.8078.74` or `Chrome/156.0.8078.74`.
 * @returns The first four-part version's major number, or `undefined` when the text holds no such version.
 *
 * @example
 * ```ts
 * chromeMajorOf('Google Chrome 156.0.8078.74') // => 156
 * chromeMajorOf('Chrome') // => undefined
 * ```
 */
export function chromeMajorOf(versionText: string): number | undefined {
  return chromeVersionOf(versionText)?.major
}

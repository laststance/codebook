/**
 * Reads the major version out of Chrome's own spelling of its version.
 *
 * It exists so the owned launch ({@link assertSupportedChromeVersion}) and the saved-session store (which records and compares the major of the Chrome that set a profile up) read a version the same way.
 * Called by `assertSupportedChromeVersion` and, from lane A's store, by the admission of a saved-session run.
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
  const version = /(\d+)\.\d+\.\d+\.\d+/.exec(versionText)
  return version === null ? undefined : Number(version[1])
}

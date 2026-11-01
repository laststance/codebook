/** The first four-part version a Chrome version text holds: the matched text and its major number. @example const version: ChromeVersion = { text: '156.0.8078.74', major: 156 } */
export type ChromeVersion = {
  /** The four-part version as Chrome printed it, for example `156.0.8078.74`. */
  text: string
  /** The version's first number. */
  major: number
}

/**
 * Reads the first four-part version out of Chrome's own spelling of its version, keeping the matched text with its major.
 *
 * It exists so the major a check compares and the version a refusal names come from one parse: {@link chromeMajorOf} reads its major here and {@link assertSupportedChromeVersion} names the matched text, so neither can read a spelling the other does not.
 *
 * @param versionText - Chrome's spelling: `Google Chrome 156.0.8078.74`, `Chromium 156.0.8078.74`, `Google Chrome for Testing 156.0.8078.74` or `Chrome/156.0.8078.74`.
 * @returns The version's text and major, or `undefined` when the text holds no four-part version.
 *
 * @example
 * ```ts
 * chromeVersionOf('Google Chrome 156.0.8078.74') // => { text: '156.0.8078.74', major: 156 }
 * chromeVersionOf('Google Chrome') // => undefined
 * ```
 */
export function chromeVersionOf(
  versionText: string,
): ChromeVersion | undefined {
  const version = /(\d+)\.\d+\.\d+\.\d+/.exec(versionText)
  return version === null
    ? undefined
    : { text: version[0], major: Number(version[1]) }
}

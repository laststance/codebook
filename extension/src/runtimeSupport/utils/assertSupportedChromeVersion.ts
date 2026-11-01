import { CHROME_EXTENSION_MIN_VERSION } from '../../constants'
import { StudyError } from '../../errors'

import { chromeMajorOf } from './chromeMajorOf'

/**
 * Refuses a Chrome older than {@link CHROME_EXTENSION_MIN_VERSION}, whose CDP cannot load an unpacked extension.
 * Called by the owned launch with the `--version` output before the spawn, and with `Browser.getVersion`'s product after connecting. A text with no version number is refused too, naming `unknown`, because the launch cannot be proven to work.
 * @param versionText - Chrome's own spelling: `Google Chrome 156.0.8078.74`, `Chromium 156.0.8078.74`, `Google Chrome for Testing 156.0.8078.74` or `Chrome/156.0.8078.74`.
 * @throws {@link StudyError} `CHROME_VERSION_UNSUPPORTED` when the major version is below the minimum or cannot be read.
 * @example
 * assertSupportedChromeVersion('Google Chrome 156.0.8078.74') // returns
 * assertSupportedChromeVersion('Google Chrome 148.0.7778.96') // throws CHROME_VERSION_UNSUPPORTED
 */
export function assertSupportedChromeVersion(versionText: string): void {
  const major = chromeMajorOf(versionText)
  // No readable version: refuse rather than guess.
  if (major === undefined || major < CHROME_EXTENSION_MIN_VERSION)
    throw new StudyError(
      'CHROME_VERSION_UNSUPPORTED',
      `Chrome ${CHROME_EXTENSION_MIN_VERSION} or later is needed to load an unpacked extension; found ${/\d+\.\d+\.\d+\.\d+/.exec(versionText)?.[0] ?? 'unknown'}.`,
    )
}

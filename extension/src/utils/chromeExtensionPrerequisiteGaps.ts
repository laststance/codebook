import { CHROME_EXTENSION_MIN_VERSION } from '../constants'
import { StudyError } from '../errors'
import { assertSupportedChromeVersion } from '../runtimeSupport/utils/assertSupportedChromeVersion'

/**
 * Names what keeps the chrome-extension profile from running on this machine (ER7, DXR16): an unsupported system, no Chrome, or a Chrome older than {@link CHROME_EXTENSION_MIN_VERSION}.
 * Called by the environment's `prerequisites()` for the profile's entry, so `codebook_status` shows the fix before any start.
 * @param input.platform - The system the editor runs on; Windows has no verified path rule or `--version` output (ER7).
 * @param input.chromeMissing - What the existing Chrome lookup found missing, in its own words.
 * @param input.chromeVersion - What the found executable printed for `--version`; `undefined` when none was found.
 * @returns The sentences that make the profile unavailable; empty when it can run.
 * @example
 * chromeExtensionPrerequisiteGaps({ platform: 'linux', chromeMissing: [], chromeVersion: 'Google Chrome 148.0.7778.96' })
 * // => ['Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96. Set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later, or update Chrome.']
 */
export function chromeExtensionPrerequisiteGaps(input: {
  platform: NodeJS.Platform
  chromeMissing: readonly string[]
  chromeVersion: string | undefined
}): string[] {
  if (input.platform === 'win32')
    return [
      'The chrome-extension profile is not available on Windows in this version.',
    ]
  if (input.chromeMissing.length > 0 || input.chromeVersion === undefined)
    return [...input.chromeMissing]
  try {
    assertSupportedChromeVersion(input.chromeVersion)
    return []
  } catch (error) {
    if (!(error instanceof StudyError)) throw error
    return [
      `${error.message} Set codebook.chromeExecutable to Google Chrome or Chrome for Testing ${CHROME_EXTENSION_MIN_VERSION} or later, or update Chrome.`,
    ]
  }
}

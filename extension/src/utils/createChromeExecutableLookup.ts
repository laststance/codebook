import { CHROME_NOT_FOUND_REUSE_MS } from '../constants'

import { resolveChromeExecutable } from './resolveChromeExecutable'

/** What the last search of the PATH answered and when; `executable` is `undefined` when no Chrome was found. */
type RememberedSearch = {
  executable: string | undefined
  answeredAtMs: number
}

/**
 * Says whether a remembered search still answers the same question without another search of the PATH; called by the lookup of {@link createChromeExecutableLookup} for the search it remembers.
 * @param remembered - The last search's answer and when it was given.
 * @param now - The monotonic clock in milliseconds that bounds how long "no Chrome found" is reused.
 * @param isExecutable - The caller's own probe, by which a remembered executable is checked once.
 * @returns
 * - "No Chrome found": `true` within {@link CHROME_NOT_FOUND_REUSE_MS} of the answer, `false` afterwards; nothing is probed
 * - A remembered executable: `true` while the probe still finds it, `false` when it is gone
 * @example
 * await isRememberedSearchStillTrue({ executable: undefined, answeredAtMs: 0 }, () => 10, isExecutable) // => true
 */
async function isRememberedSearchStillTrue(
  remembered: RememberedSearch,
  now: () => number,
  isExecutable: (path: string) => Promise<boolean>,
): Promise<boolean> {
  // "No Chrome found" holds for a bounded time: a browser installed since then is found afterwards.
  if (remembered.executable === undefined)
    return now() - remembered.answeredAtMs < CHROME_NOT_FOUND_REUSE_MS
  return await isExecutable(remembered.executable)
}

/**
 * Makes a Chrome lookup that remembers the last search of the PATH, so that the prerequisite check behind every `codebook_status` and run start does not probe every name in every PATH directory again; created once by {@link createEnvironment}.
 *
 * Only an answer that cost a probe is remembered: a configured value and the macOS bundle path are given again for nothing. A remembered executable is
 * checked with the caller's own `isExecutable` before it is given again, and one that is gone is dropped and the PATH searched once more, so a learner who
 * replaces one browser with another is not told that Chrome is missing. "No Chrome found" is given again without a probe for {@link CHROME_NOT_FOUND_REUSE_MS}.
 *
 * @param now - A monotonic clock in milliseconds, which bounds how long "no Chrome found" is reused; tests name their own.
 * @returns A function with the parameters and the results of {@link resolveChromeExecutable}.
 * @example
 * const lookUpChromeExecutable = createChromeExecutableLookup()
 * await lookUpChromeExecutable('', 'linux', '/usr/bin', isExecutable) // => '/usr/bin/google-chrome', after probing the PATH
 * await lookUpChromeExecutable('', 'linux', '/usr/bin', isExecutable) // => '/usr/bin/google-chrome', after one probe of that path
 */
export function createChromeExecutableLookup(
  now: () => number = () => performance.now(),
): typeof resolveChromeExecutable {
  // Holds at most one search, the last, under the setting, platform and PATH it answered.
  const lastSearch = new Map<string, RememberedSearch>()
  return async (configured, platform, searchPath, isExecutable) => {
    const question = JSON.stringify([configured, platform, searchPath])
    const remembered = lastSearch.get(question)
    if (
      remembered &&
      (await isRememberedSearchStillTrue(remembered, now, isExecutable))
    )
      return remembered.executable
    let didProbe = false
    const executable = await resolveChromeExecutable(
      configured,
      platform,
      searchPath,
      (path) => {
        didProbe = true
        return isExecutable(path)
      },
    )
    // An answer given without a probe is not worth remembering, and remembering it would add a probe to the next call.
    lastSearch.clear()
    if (didProbe) lastSearch.set(question, { executable, answeredAtMs: now() })
    return executable
  }
}

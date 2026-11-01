import { rm } from 'node:fs/promises'

/** How often the removal is tried again after a busy answer; with {@link PROFILE_REMOVAL_RETRY_DELAY_MS} the last try comes about 5.5 s after the first. */
const PROFILE_REMOVAL_RETRIES = 10
/** The pause before the first retry; Node's `rm` waits this much longer before each further one. */
const PROFILE_REMOVAL_RETRY_DELAY_MS = 100

/**
 * Removes a test Chrome's profile folder after its main process ended, trying again while the folder is still busy.
 *
 * Why it exists: on macOS, Chrome's helper processes (network service, GPU) can still write the disk cache for a moment after the main process was killed, so a single recursive removal fails with `ENOTEMPTY` under a loaded suite. Called by the real-Chrome test helpers ({@link closeRealChrome}, {@link launchRealHeadlessPage}) when their test ends.
 * @param profile - The profile folder the test's Chrome used.
 * @returns When the folder is gone.
 * @throws The last error once the retries are used up, or at once for an error that is no busy answer.
 * @example await removeTestBrowserProfile(chrome.profile)
 */
export function removeTestBrowserProfile(profile: string): Promise<void> {
  return rm(profile, {
    recursive: true,
    force: true,
    maxRetries: PROFILE_REMOVAL_RETRIES,
    retryDelay: PROFILE_REMOVAL_RETRY_DELAY_MS,
  })
}

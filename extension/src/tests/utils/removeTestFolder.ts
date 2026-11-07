import { rm } from 'node:fs/promises'

/** How often the removal is tried again after a busy answer; with {@link TEST_FOLDER_REMOVAL_RETRY_DELAY_MS} the last of the six tries comes about 1.5 s after the first. */
const TEST_FOLDER_REMOVAL_RETRIES = 5
/** The pause before the first retry; Node's `rm` waits this much longer before each further one. */
const TEST_FOLDER_REMOVAL_RETRY_DELAY_MS = 100

/**
 * Removes a test's temporary folder at cleanup, trying again while a writer is still finishing a file inside it.
 *
 * Why it exists: under a loaded full-suite run, a frame writer or a step the test left running can still create a file in the folder while the recursive removal walks it, so a single `rm` fails with `ENOTEMPTY`. Called by the cleanup of the tests (`after`, `finally`, harness `close`) instead of a bare recursive `rm`; a removal that is part of a test's Arrange or Act (a learner or tool deleting the folder) keeps `rm`.
 * @param path - The temporary folder (or file) the test created.
 * @returns When the folder is gone; an absent folder is no error.
 * @throws The last error once the retries are used up, or at once for an error that is no busy answer (`EACCES`).
 * @example await removeTestFolder(directory)
 */
export function removeTestFolder(path: string): Promise<void> {
  return rm(path, {
    recursive: true,
    force: true,
    maxRetries: TEST_FOLDER_REMOVAL_RETRIES,
    retryDelay: TEST_FOLDER_REMOVAL_RETRY_DELAY_MS,
  })
}

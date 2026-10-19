/**
 * A process id that names no process on any system the suite runs on, for a test that needs "a process that has ended" or "another process" without racing the system's reuse of a real id.
 * It lies above Linux's highest id (2^22) and above macOS's, and it is no multiple of four as every Windows id is.
 * @example
 * isProcessGone(ID_OF_NO_PROCESS) // => true
 */
export const ID_OF_NO_PROCESS = 2 ** 22 + 1

/**
 * A second process id that names no process, for a test that needs two processes that have ended (a killed window's lock and the claim another killed window left): {@link ID_OF_NO_PROCESS} and this one. It lies above Linux's and macOS's highest ids as well, and it is odd, so no Windows id either.
 * @example
 * isProcessGone(ANOTHER_ID_OF_NO_PROCESS) // => true
 */
export const ANOTHER_ID_OF_NO_PROCESS = 2 ** 22 + 3

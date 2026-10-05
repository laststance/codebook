/**
 * A process id that names no process on any system the suite runs on, for a test that needs "a process that has ended" or "another process" without racing the system's reuse of a real id.
 * It lies above Linux's highest id (2^22) and above macOS's, and it is no multiple of four as every Windows id is.
 * @example
 * isProcessGone(ID_OF_NO_PROCESS) // => true
 */
export const ID_OF_NO_PROCESS = 2 ** 22 + 1

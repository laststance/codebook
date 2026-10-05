/**
 * The failure of a Cursor Wiki update whose agent ran past its bound, thrown by {@link runCursorWikiUpdate}.
 * The extension tells it from a cancel or a failed agent by this type, never by its message or name, and records the run as `timed-out` instead of `failed`.
 * @example
 * try {
 *   await runCursorWikiUpdate('/repo', prompt, controller.signal, 900_000)
 * } catch (error) {
 *   error instanceof WikiUpdateTimeoutError // => true once the 15 minutes passed
 * }
 */
export class WikiUpdateTimeoutError extends Error {}

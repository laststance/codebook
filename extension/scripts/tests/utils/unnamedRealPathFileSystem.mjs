import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The folder whose real path a test asked to fail, with its system error code and how many more calls fail; undefined while none is asked for. */
let failing

/**
 * Asks `realpath` to fail for one folder with a system error, as it does for a folder of another user (`EACCES`) or for some junctions on Windows (`EINVAL`), for every call until the test asks again, or for the next `times` calls only, as a folder another process moves away and back does. Called by the publisher's tests before they prepare a Wiki with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {string | undefined} path - The folder whose real path cannot be named; `undefined` to fail for none.
 * @param {'EACCES' | 'EINVAL'} [code] - The system error.
 * @param {number} [times] - How many calls for the folder fail; every call when left out.
 * @returns {void}
 * @example
 * failRealPathOf('/repo/.codebook', 'EACCES')
 * failRealPathOf('/outside/next', 'EACCES', 1) // only the next call for /outside/next fails
 */
export function failRealPathOf(path, code, times = Infinity) {
  failing = path === undefined ? undefined : { path, code, times }
}

/**
 * Answers the real path as `realpath` does, except for the folder of {@link failRealPathOf}, for which it fails with the asked system error.
 * @param {string} path - The path whose real path is asked for.
 * @param {...unknown} options - The caller's options, handed on unchanged.
 * @returns {Promise<string>} What `realpath` answers.
 * @example
 * await realpath('/repo/.codebook') // rejects with code EACCES after failRealPathOf('/repo/.codebook', 'EACCES')
 */
export async function realpath(path, ...options) {
  // Only the asked folder fails, as many times as asked; every other path has its real answer.
  if (failing && failing.times > 0 && String(path) === failing.path) {
    failing.times -= 1
    throw Object.assign(new Error(`${failing.code}: realpath '${path}'`), {
      code: failing.code,
    })
  }
  return fileSystem.realpath(path, ...options)
}

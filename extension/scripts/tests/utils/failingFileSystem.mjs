import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The write a test asked to fail: the file it waits for and the system error it fails with; gone once it failed. */
let pendingWriteFailure

/**
 * Asks the next write through a handle of a file that `isAwaited` names to write the first half of its bytes and then fail with a system error, once: as a write that runs into a full disk (`ENOSPC`) or a file size limit (`EFBIG` under `ulimit -f`) after its `open` made the file. Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether a file `open` is asked for is the one whose write fails.
 * @param {'EFBIG' | 'ENOSPC'} code - The system error.
 * @returns {void}
 * @example
 * failWriteOf((path) => path.endsWith('/next/manual.txt'), 'EFBIG')
 */
export function failWriteOf(isAwaited, code) {
  pendingWriteFailure = { isAwaited, code }
}

/**
 * Wraps an open handle so that its `writeFile` writes the first half of the bytes and then fails with `code`; every other member is the handle's own.
 * @param {import('node:fs/promises').FileHandle} handle - The handle `open` answered.
 * @param {string} code - The system error.
 * @returns {import('node:fs/promises').FileHandle} The wrapped handle.
 * @example
 * await handleWhoseWriteFails(await fileSystem.open(path, 'wx'), 'EFBIG').writeFile('abcd') // rejects with code EFBIG after writing 'ab'
 */
function handleWhoseWriteFails(handle, code) {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'writeFile')
        return async (data) => {
          const bytes = Buffer.from(data)
          await target.write(bytes, 0, Math.floor(bytes.length / 2))
          throw Object.assign(new Error(`${code}: the write stopped partway`), {
            code,
          })
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Opens a file as `open` does; the handle of the file {@link failWriteOf} waits for fails its write partway, once.
 * @param {string} path - The file to open.
 * @param {...unknown} rest - The caller's flags and mode, handed on unchanged.
 * @returns {Promise<import('node:fs/promises').FileHandle>} What `open` answers, wrapped for the awaited file.
 * @example
 * await open('/repo/.codebook/next/manual.txt', 'wx') // => a handle whose writeFile fails partway, after failWriteOf named this file
 */
export async function open(path, ...rest) {
  const handle = await fileSystem.open(path, ...rest)
  const failure = pendingWriteFailure
  // Only the awaited file's handle fails, once.
  if (!failure?.isAwaited(String(path))) return handle
  pendingWriteFailure = undefined
  return handleWhoseWriteFails(handle, failure.code)
}

import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The write a test asked to fail: the file it waits for, the system error it fails with and what runs before it fails; gone once it failed. */
let pendingWriteFailure

/**
 * Asks the next write of a file that `isAwaited` names, through a handle of its `open` or by `writeFile`, to write the first half of its bytes and then fail with a system error, once: as a write that runs into a full disk (`ENOSPC`) or a file size limit (`EFBIG` under `ulimit -f`) after it made the file. Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether a file `open` or `writeFile` is asked for is the one whose write fails.
 * @param {'EFBIG' | 'ENOSPC'} code - The system error.
 * @param {(path: string) => Promise<void>} [swap] - Runs, with the file's path, once the first half is written and before the write fails, while the handle is still open: as another process that puts a file of its own at the name meanwhile.
 * @returns {void}
 * @example
 * failWriteOf((path) => path.endsWith('/next/manual.txt'), 'EFBIG', async (path) => { await rm(path); await writeFile(path, 'Another process’s notes') })
 */
export function failWriteOf(isAwaited, code, swap) {
  pendingWriteFailure = { isAwaited, code, swap }
}

/** The status read or the close through a handle that a test asked to fail: the file it waits for, the call, the system error and what runs first in the failing call; gone once it failed. */
let pendingHandleCallFailure

/**
 * Asks the next close of a handle of a file that `isAwaited` names to close the file and then fail with a system error, once: as a close on a network or synced file system that runs into a full disk (`ENOSPC`) or a quota (`EDQUOT`) after the whole write was handed on. Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether a file `open` is asked for is the one whose close fails.
 * @param {'EDQUOT' | 'ENOSPC'} code - The system error.
 * @param {(path: string) => Promise<void>} [swap] - Runs, with the file's path, before the close closes the file and fails, while the handle is still open: as another process that puts a file of its own at the name meanwhile.
 * @returns {void}
 * @example
 * failCloseOf((path) => path.endsWith('/next/manual.txt'), 'ENOSPC', async (path) => { await rm(path); await writeFile(path, 'Another process’s notes') })
 */
export function failCloseOf(isAwaited, code, swap) {
  pendingHandleCallFailure = { isAwaited, call: 'close', code, swap }
}

/**
 * Asks the next status read through a handle of a file that `isAwaited` names to fail with a system error, once, right after its `open` made the file: as a read error of the disk (`EIO`). Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether a file `open` is asked for is the one whose status read fails.
 * @param {'EIO'} code - The system error.
 * @param {(path: string) => Promise<void>} [swap] - Runs, with the file's path, before the status read fails: as another process that puts a file of its own at the name meanwhile.
 * @returns {void}
 * @example
 * failStatOf((path) => path.endsWith('/next/manual.txt'), 'EIO', async (path) => { await rm(path); await writeFile(path, 'Another process’s notes') })
 */
export function failStatOf(isAwaited, code, swap) {
  pendingHandleCallFailure = { isAwaited, call: 'stat', code, swap }
}

/**
 * Wraps an open handle so that its `close` runs `swap`, closes the file and then fails with `code`, or its `stat` runs `swap` and then fails with `code` and reads nothing; every other member is the handle's own.
 * @param {import('node:fs/promises').FileHandle} handle - The handle `open` answered.
 * @param {'close' | 'stat'} call - The call that fails.
 * @param {string} code - The system error.
 * @param {() => Promise<void>} [swap] - What runs first in the failing call, while the handle is still open.
 * @returns {import('node:fs/promises').FileHandle} The wrapped handle.
 * @example
 * await handleWhoseCallFails(await fileSystem.open(path, 'wx'), 'close', 'ENOSPC').close() // rejects with code ENOSPC after the file was closed
 */
function handleWhoseCallFails(handle, call, code, swap) {
  const failure = () =>
    Object.assign(new Error(`${code}: the ${call} of the file failed`), {
      code,
    })
  return new Proxy(handle, {
    get(target, property) {
      // The close closes the file before it fails, so no descriptor is left open; the swap runs while the file is still open, so a file it puts at the name cannot take the open file's id.
      if (property === call && call === 'close')
        return async () => {
          await swap?.()
          await target.close()
          throw failure()
        }
      if (property === call)
        return async () => {
          await swap?.()
          throw failure()
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Wraps an open handle so that its `writeFile` writes the first half of the bytes, runs `swap` and then fails with `code`; every other member is the handle's own.
 * @param {import('node:fs/promises').FileHandle} handle - The handle `open` answered.
 * @param {string} code - The system error.
 * @param {() => Promise<void>} [swap] - What runs after the first half is written and before the write fails.
 * @returns {import('node:fs/promises').FileHandle} The wrapped handle.
 * @example
 * await handleWhoseWriteFails(await fileSystem.open(path, 'wx'), 'EFBIG').writeFile('abcd') // rejects with code EFBIG after writing 'ab'
 */
function handleWhoseWriteFails(handle, code, swap) {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'writeFile')
        return async (data) => {
          const bytes = Buffer.from(data)
          await target.write(bytes, 0, Math.floor(bytes.length / 2))
          await swap?.()
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
 * Opens a file as `open` does; the handle of the file {@link failWriteOf} waits for fails its write partway, once, and the handle of the file {@link failCloseOf} or {@link failStatOf} waits for fails that call, once.
 * @param {string} path - The file to open.
 * @param {...unknown} rest - The caller's flags and mode, handed on unchanged.
 * @returns {Promise<import('node:fs/promises').FileHandle>} What `open` answers, wrapped for the awaited file.
 * @example
 * await open('/repo/.codebook/next/manual.txt', 'wx') // => a handle whose writeFile fails partway, after failWriteOf named this file
 */
export async function open(path, ...rest) {
  const handle = await fileSystem.open(path, ...rest)
  const failure = pendingWriteFailure,
    callFailure = pendingHandleCallFailure
  // Only the awaited file's handle fails, once.
  if (callFailure?.isAwaited(String(path))) {
    pendingHandleCallFailure = undefined
    return handleWhoseCallFails(
      handle,
      callFailure.call,
      callFailure.code,
      callFailure.swap && (() => callFailure.swap(String(path))),
    )
  }
  if (!failure?.isAwaited(String(path))) return handle
  pendingWriteFailure = undefined
  return handleWhoseWriteFails(
    handle,
    failure.code,
    failure.swap && (() => failure.swap(String(path))),
  )
}

/** The renames a test asked to fail: the source each waits for, the system errors still to come, one per call, and what runs before each fails. */
const pendingRenameFailures = []

/** The optional observer of {@link observeRemovals}. */
let removalObserver

/**
 * Asks the next renames of a folder or file that `isAwaited` names to fail, one call per code in `codes`, in turn: as Windows answers `EBUSY` or `EPERM` while an indexer, a virus scanner or a watcher holds the folder for a moment, or a move that cannot succeed at all (`EXDEV`). Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether the source of a rename is the one whose renames fail.
 * @param {string[]} codes - The system errors of the next calls, one each; later calls succeed.
 * @param {(path: string) => Promise<void>} [swap] - Runs, with the source's path, before each failing call rejects, once nothing was moved: as another process that puts a file of its own at the name meanwhile.
 * @returns {() => void} Drops the errors still to come, so none is left for another test.
 * @example
 * const stop = failRenameOf((path) => path === '/repo/.codebook/wiki', ['EBUSY', 'EPERM']); stop()
 */
export function failRenameOf(isAwaited, codes, swap) {
  const failure = { isAwaited, codes: [...codes], swap }
  pendingRenameFailures.push(failure)
  return () => {
    failure.codes.length = 0
  }
}

/**
 * Asks every `unlink` to tell `observer` its path first, as long as the observer is not stopped; so a test sees when the publisher removes a file relative to its moves.
 * @param {(path: string) => void} observer - Receives the path of each removal before it runs.
 * @returns {() => void} Stops this observer without clearing a newer one.
 * @example
 * const stop = observeRemovals((path) => removals.push(path)); stop()
 */
export function observeRemovals(observer) {
  removalObserver = observer
  return () => {
    if (removalObserver === observer) removalObserver = undefined
  }
}

/**
 * Renames as `rename` does, except while {@link failRenameOf} holds a system error for the source: then the call runs that request's swap, if any, and fails with the error, and nothing is moved.
 * @param {string} from - What is moved.
 * @param {string} to - Where it goes.
 * @returns {Promise<void>} What `rename` answers.
 * @example
 * await rename('/repo/.codebook/wiki', '/repo/.codebook/wiki.previous-1') // rejects with code EBUSY after failRenameOf named the Wiki folder with ['EBUSY']
 */
export async function rename(from, to) {
  const failure = pendingRenameFailures.find(
    (candidate) =>
      candidate.codes.length > 0 && candidate.isAwaited(String(from)),
  )
  // The awaited source fails once per code still to come; every other rename moves.
  if (failure !== undefined) {
    const code = failure.codes.shift()
    await failure.swap?.(String(from))
    throw Object.assign(new Error(`${code}: rename '${from}' -> '${to}'`), {
      code,
    })
  }
  return fileSystem.rename(from, to)
}

/**
 * Removes a file as `unlink` does, after telling the observer of {@link observeRemovals} its path.
 * @param {string} path - The file to remove.
 * @returns {Promise<void>} What `unlink` answers.
 * @example
 * await unlink('/repo/.codebook/next/index.html')
 */
export async function unlink(path) {
  removalObserver?.(String(path))
  return fileSystem.unlink(path)
}

/**
 * Writes a file as `writeFile` does, except for the file {@link failWriteOf} waits for: that write puts the first half of the bytes into the file, with the caller's flags, and then fails with the system error, once.
 * @param {string} path - The file to write.
 * @param {string | Buffer} data - Its bytes.
 * @param {...unknown} rest - The caller's options, handed on unchanged.
 * @returns {Promise<void>} What `writeFile` answers.
 * @example
 * await writeFile('/repo/.codebook/wiki.publish-journal.json', journalText, { flag: 'wx' }) // rejects with code ENOSPC after writing half of it, after failWriteOf named this file
 */
export async function writeFile(path, data, ...rest) {
  const failure = pendingWriteFailure
  // Only the awaited file's write fails, once.
  if (!failure?.isAwaited(String(path)))
    return fileSystem.writeFile(path, data, ...rest)
  pendingWriteFailure = undefined
  const bytes = Buffer.from(data)
  await fileSystem.writeFile(
    path,
    bytes.subarray(0, Math.floor(bytes.length / 2)),
    ...rest,
  )
  throw Object.assign(new Error(`${failure.code}: the write stopped partway`), {
    code: failure.code,
  })
}

/** The hard link a test asked to fail: the new name it waits for and the system error it fails with; gone once it failed. */
let pendingLinkFailure

/**
 * Asks the next hard link that gives a file a name `isAwaited` names to fail with a system error, once, and make no name: as a file system that cannot link does (`EPERM` on FAT and exFAT volumes, `ENOTSUP` on some network shares). Called by the publisher's tests before they publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether the new name of a link is the one whose link fails.
 * @param {'ENOTSUP' | 'EPERM'} code - The system error.
 * @returns {void}
 * @example
 * failLinkOf((path) => path.endsWith('/wiki.publish-journal.json'), 'EPERM')
 */
export function failLinkOf(isAwaited, code) {
  pendingLinkFailure = { isAwaited, code }
}

/**
 * Gives a file a second name as `link` does, except for the name {@link failLinkOf} waits for: that link fails with the system error, once, and makes no name.
 * @param {string} existingPath - The file.
 * @param {string} newPath - Its new name.
 * @returns {Promise<void>} What `link` answers.
 * @example
 * await link('/repo/.codebook/wiki.publish-journal.json.pending-1', '/repo/.codebook/wiki.publish-journal.json') // rejects with code EPERM after failLinkOf named the journal
 */
export async function link(existingPath, newPath) {
  const failure = pendingLinkFailure
  // Only the awaited name's link fails, once.
  if (!failure?.isAwaited(String(newPath)))
    return fileSystem.link(existingPath, newPath)
  pendingLinkFailure = undefined
  throw Object.assign(
    new Error(`${failure.code}: link '${existingPath}' -> '${newPath}'`),
    { code: failure.code },
  )
}

import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The swaps a test asked for, by the call before which each runs, and which path each waits for; a swap is gone once it ran. */
const pendingSwaps = {
  mkdir: undefined,
  writeFile: undefined,
  readFile: undefined,
  rename: undefined,
  halfwayWrite: undefined,
}

/** The optional read observer of {@link observeFileReads}; it holds no file bytes itself. */
let readObserver

/**
 * Observes completed reads for the bounded image-buffer probe without keeping their bytes in this seam.
 * @param {(path: string, bytes: string | Buffer) => void} observer - Receives the read path and result.
 * @returns {() => void} Stops this observer without clearing a newer one.
 * @example
 * const stop = observeFileReads((path, bytes) => { if (Buffer.isBuffer(bytes)) references.push(new WeakRef(bytes)) }); stop()
 */
export function observeFileReads(observer) {
  readObserver = observer
  return () => {
    if (readObserver === observer) readObserver = undefined
  }
}

/**
 * Asks the next `mkdir` of a folder that `isAwaited` names to run `swap` first, once: as another process that swaps a folder on the Wiki output's path for a link between the publisher's look at the path and the folder it then makes. Called by the publisher's tests before they prepare or publish a Wiki with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {(path: string) => boolean} isAwaited - Whether a folder `mkdir` is asked for is the one before which the swap runs.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapBeforeMaking((path) => path.endsWith('.codebook'), () => symlink(outside, join(root, '.codebook')))
 */
export function swapBeforeMaking(isAwaited, swap) {
  pendingSwaps.mkdir = { isAwaited, swap }
}

/**
 * Asks the next write of a file that `isAwaited` names to run `swap` first, once, as {@link swapBeforeMaking} does for `mkdir`: a `writeFile` of it, or an `open` of it to write, through whose handle the publisher writes the files it records as its own. Called by the publisher's tests before they prepare, publish or recover a Wiki with the same copy.
 * @param {(path: string) => boolean} isAwaited - Whether a file `writeFile` is asked for is the one before which the swap runs.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapBeforeWriting((path) => path.includes('.recovery-'), () => symlink(outside, join(root, '.codebook')))
 */
export function swapBeforeWriting(isAwaited, swap) {
  pendingSwaps.writeFile = { isAwaited, swap }
}

/**
 * Asks the next write through a handle of a file that `isAwaited` names to run `swap` once half of its bytes are written, once, and then to write the rest: as a kill of the publisher while it writes a large file, which leaves the part written so far, since a write goes from the first byte on. Called by the probe that kills a publisher process (`killedPublisherProbe.mjs`).
 * @param {(path: string) => boolean} isAwaited - Whether a file `open` is asked to write is the one whose write runs the swap halfway.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapHalfwayThroughWriting((path) => path.endsWith('/next/manual.txt'), async () => process.kill(process.pid, 'SIGKILL'))
 */
export function swapHalfwayThroughWriting(isAwaited, swap) {
  pendingSwaps.halfwayWrite = { isAwaited, swap }
}

/**
 * Wraps an open handle so that its `writeFile` writes the first half of the bytes, runs `swap`, then writes the rest; every other member is the handle's own.
 * @param {import('node:fs/promises').FileHandle} handle - The handle `open` answered.
 * @param {() => Promise<void>} swap - The swap of {@link swapHalfwayThroughWriting}.
 * @returns {import('node:fs/promises').FileHandle} The wrapped handle.
 * @example
 * await handleThatSwapsHalfway(await fileSystem.open(path, 'wx'), swap).writeFile('abcd') // writes 'ab', runs the swap, then writes 'cd'
 */
function handleThatSwapsHalfway(handle, swap) {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'writeFile')
        return async (data) => {
          const bytes = Buffer.from(data),
            half = Math.floor(bytes.length / 2)
          await target.write(bytes, 0, half)
          await swap()
          await target.write(bytes, half, bytes.length - half)
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Asks the next `readFile` of a file that `isAwaited` names to run `swap` first, once, as {@link swapBeforeMaking} does for `mkdir`. Called by the publisher's tests that swap a folder between two of its looks with no write between them.
 * @param {(path: string) => boolean} isAwaited - Whether a file `readFile` is asked for is the one before which the swap runs.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapBeforeReading((path) => path.endsWith('codebook-wiki.json'), () => symlink(outside, join(root, '.codebook')))
 */
export function swapBeforeReading(isAwaited, swap) {
  pendingSwaps.readFile = { isAwaited, swap }
}

/**
 * Asks the next `rename` whose source `isAwaited` names to run `swap` first, once, as {@link swapBeforeMaking} does for `mkdir`: as a stop of the publisher between the write of a file and its move into place. Called by the publisher's tests through the probe that kills a publisher process (`killedPublisherProbe.mjs`).
 * @param {(path: string) => boolean} isAwaited - Whether the source of a rename is the one before which the swap runs.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapBeforeRenaming((path) => path.includes('.codebook-publish-'), async () => process.kill(process.pid, 'SIGKILL'))
 */
export function swapBeforeRenaming(isAwaited, swap) {
  pendingSwaps.rename = { isAwaited, swap }
}

/**
 * Runs the swap waiting before a call of `kind` when the call's path is the one it waits for, once; called by {@link mkdir}, {@link writeFile}, {@link open}, {@link readFile} and {@link rename}.
 * @param {'mkdir' | 'writeFile' | 'readFile' | 'rename'} kind - The call about to run.
 * @param {string | URL} path - The call's path.
 * @returns {Promise<void>} Once the swap ran, or at once when none waits for this path.
 * @example
 * await swapIfAwaited('mkdir', '/repo/.codebook/wiki.stage-1')
 */
async function swapIfAwaited(kind, path) {
  const awaited = pendingSwaps[kind]
  // The swap runs once, before the call it waits for.
  if (!awaited?.isAwaited(String(path))) return
  pendingSwaps[kind] = undefined
  await awaited.swap()
}

/**
 * Makes a folder as `mkdir` does, after the swap of {@link swapBeforeMaking} when this is the folder it waits for.
 * @param {string} path - The folder to make.
 * @param {...unknown} options - The caller's options, handed on unchanged.
 * @returns {Promise<string | undefined>} What `mkdir` answers.
 * @example
 * await mkdir('/repo/.codebook/wiki.stage-1') // => undefined, after the swap that waited for it
 */
export async function mkdir(path, ...options) {
  await swapIfAwaited('mkdir', path)
  return fileSystem.mkdir(path, ...options)
}

/**
 * Writes a file as `writeFile` does, after the swap of {@link swapBeforeWriting} when this is the file it waits for.
 * @param {string} path - The file to write.
 * @param {...unknown} rest - The data and the caller's options, handed on unchanged.
 * @returns {Promise<void>} What `writeFile` answers.
 * @example
 * await writeFile('/repo/.codebook/wiki.publish-journal.json.recovery-…', claim, { flag: 'wx' })
 */
export async function writeFile(path, ...rest) {
  await swapIfAwaited('writeFile', path)
  return fileSystem.writeFile(path, ...rest)
}

/**
 * Opens a file as `open` does, after the swap of {@link swapBeforeWriting} when the file is opened to be written and is the file the swap waits for, as {@link writeFile} does; the handle of the file {@link swapHalfwayThroughWriting} waits for runs that swap halfway through its write, once.
 * @param {string} path - The file to open.
 * @param {string | number} [flags] - How the file is opened, as `open` takes it.
 * @param {...unknown} rest - The caller's mode, handed on unchanged.
 * @returns {Promise<import('node:fs/promises').FileHandle>} What `open` answers, wrapped for the file awaited halfway through its write.
 * @example
 * await open('/repo/.codebook/next/manual.txt', 'wx') // => a handle, after the swap that waited for this file
 */
export async function open(path, flags, ...rest) {
  // Only an open to write is a write the swaps wait for; a numeric flag the publisher does not use is left alone.
  const isWrite = typeof flags === 'string' && /[wa+]/.test(flags)
  if (isWrite) await swapIfAwaited('writeFile', path)
  const handle = await fileSystem.open(path, flags, ...rest)
  const halfway = pendingSwaps.halfwayWrite
  // Only the awaited file's handle runs its swap halfway through its write, once.
  if (!isWrite || !halfway?.isAwaited(String(path))) return handle
  pendingSwaps.halfwayWrite = undefined
  return handleThatSwapsHalfway(handle, halfway.swap)
}

/**
 * Reads a file as `readFile` does, after the swap of {@link swapBeforeReading} when this is the file it waits for.
 * @param {string} path - The file to read.
 * @param {...unknown} options - The caller's options, handed on unchanged.
 * @returns {Promise<string | Buffer>} What `readFile` answers.
 * @example
 * await readFile('/repo/.codebook/wiki.previous-1/codebook-wiki.json')
 */
export async function readFile(path, ...options) {
  await swapIfAwaited('readFile', path)
  const bytes = await fileSystem.readFile(path, ...options)
  readObserver?.(String(path), bytes)
  return bytes
}

/**
 * Moves a folder or file as `rename` does, after the swap of {@link swapBeforeRenaming} when its source is the one the swap waits for.
 * @param {string} from - What is moved.
 * @param {string} to - Where it goes.
 * @returns {Promise<void>} What `rename` answers.
 * @example
 * await rename('/repo/.codebook/next/.codebook-publish-1-codebook-wiki.json', '/repo/.codebook/next/codebook-wiki.json')
 */
export async function rename(from, to) {
  await swapIfAwaited('rename', from)
  return fileSystem.rename(from, to)
}

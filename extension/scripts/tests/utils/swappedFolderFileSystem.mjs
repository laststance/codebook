import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The swaps a test asked for, by the call before which each runs, and which path each waits for; a swap is gone once it ran. */
const pendingSwaps = {
  mkdir: undefined,
  writeFile: undefined,
  readFile: undefined,
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
 * Asks the next `writeFile` of a file that `isAwaited` names to run `swap` first, once, as {@link swapBeforeMaking} does for `mkdir`. Called by the publisher's tests before they recover a Wiki with the same copy.
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
 * Runs the swap waiting before a call of `kind` when the call's path is the one it waits for, once; called by {@link mkdir}, {@link writeFile} and {@link readFile}.
 * @param {'mkdir' | 'writeFile' | 'readFile'} kind - The call about to run.
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
 * Reads a file as `readFile` does, after the swap of {@link swapBeforeReading} when this is the file it waits for.
 * @param {string} path - The file to read.
 * @param {...unknown} options - The caller's options, handed on unchanged.
 * @returns {Promise<string | Buffer>} What `readFile` answers.
 * @example
 * await readFile('/repo/.codebook/wiki.previous-1/codebook-wiki.json')
 */
export async function readFile(path, ...options) {
  await swapIfAwaited('readFile', path)
  return fileSystem.readFile(path, ...options)
}

import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The swap a test asked for, and which folder it waits for; undefined once it ran. */
let pendingSwap

/**
 * Asks the next `mkdir` of a folder that `isAwaited` names to run `swap` first, once: as another process that swaps a folder on the Wiki output's path for a link between the publisher's look at the path and the folder it then makes. Called by the publisher's tests before they prepare a Wiki with the copy that gets this module as its `node:fs/promises` (the loader hook of `swappedFolderHooks.mjs`).
 * @param {(path: string) => boolean} isAwaited - Whether a folder `mkdir` is asked for is the one before which the swap runs.
 * @param {() => Promise<void>} swap - The swap.
 * @returns {void}
 * @example
 * swapBeforeMaking((path) => path.endsWith('.codebook'), () => symlink(outside, join(root, '.codebook')))
 */
export function swapBeforeMaking(isAwaited, swap) {
  pendingSwap = { isAwaited, swap }
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
  const awaited = pendingSwap
  // The swap runs once, before the folder it waits for.
  if (awaited?.isAwaited(String(path))) {
    pendingSwap = undefined
    await awaited.swap()
  }
  return fileSystem.mkdir(path, ...options)
}

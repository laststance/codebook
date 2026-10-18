import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/**
 * Looks at an entry as the file system layer of Node.js does on Windows for a junction whose target is a volume: it answers for a link what `stat` answers for the folder the link leads to, so the entry looks like a directory of its own; every other entry is looked at as usual. The publisher's copy under test gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark), so only a caller that also asks where the entry really is (`realpath`) sees the link.
 * @param {string} path - The entry to look at.
 * @returns {Promise<import('node:fs').Stats>} The status `lstat` answers, or `stat`'s for a link.
 * @example
 * (await lstat('/repo/.codebook')).isDirectory() // => true while `.codebook` is a link to a folder
 */
export async function lstat(path) {
  const entry = await fileSystem.lstat(path)
  return entry.isSymbolicLink() ? fileSystem.stat(path) : entry
}

/** The mark of a module URL whose `node:fs/promises` is the stand-in of `swappedFolderFileSystem.mjs`: a test imports the publisher with it to get a copy of its own. */
const SWAPPED_FOLDER_MARK = '?swapped-folder'

/**
 * Resolves `node:fs/promises` to the stand-in that runs a test's swap before it makes a folder, for a module imported with {@link SWAPPED_FOLDER_MARK} alone. The modules that module imports in turn carry no mark and keep the real file system, as does every other import. Registered by the publisher's tests with `module.register`, so a script test can swap a folder on the output's path at the moment the shipped publisher makes a folder, without a flag of the test runner.
 * @param {string} specifier - What the importing module names.
 * @param {{ parentURL?: string }} context - Where the import comes from.
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve - The resolution the stand-in leaves every other import to.
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>} The stand-in's URL for the marked copy's file system, the usual resolution otherwise.
 * @example
 * await resolve('node:fs/promises', { parentURL: 'file:///ext/skills/codebook/publish-wiki.mjs?swapped-folder' }, nextResolve) // => { url: 'file:///…/swappedFolderFileSystem.mjs', shortCircuit: true }
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'node:fs/promises' &&
    context.parentURL?.endsWith(SWAPPED_FOLDER_MARK)
  )
    return {
      url: new URL('./swappedFolderFileSystem.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  return nextResolve(specifier, context)
}

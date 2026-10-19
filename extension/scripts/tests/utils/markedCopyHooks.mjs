/**
 * The stand-in for `node:fs/promises` of each mark a test imports a skill module with, so the test gets a copy of the module of its own:
 * - `?wrong-look`: `wrongLookFileSystem.mjs`, whose `lstat` calls a link a directory, as Node.js does on Windows for a junction to a volume;
 * - `?swapped-folder`: `swappedFolderFileSystem.mjs`, which runs a test's swap of a folder just before a `mkdir` (`swapBeforeMaking`), a `writeFile` or an `open` to write (`swapBeforeWriting`), a `readFile` (`swapBeforeReading`) or a `rename` (`swapBeforeRenaming`) of a path the test names;
 * - `?unnamed-real-path`: `unnamedRealPathFileSystem.mjs`, whose `realpath` fails for the folder a test names;
 * - `?crlf-shell`: `crlfShellFileSystem.mjs`, which reads the reader shell with CRLF line endings;
 * - `?large-file-ids`: `largeFileIdsFileSystem.mjs`, which gives the folder a test names file ids above 2^53 that change in their low bits (`giveLargeFileIds`);
 * - `?failing`: `failingFileSystem.mjs`, whose write through a handle of the file a test names stops partway with a system error (`failWriteOf`), whose rename of a path a test names fails with the system errors it names (`failRenameOf`), and whose `unlink` tells a test's observer each path first (`observeRemovals`).
 */
const STAND_INS = {
  '?wrong-look': './wrongLookFileSystem.mjs',
  '?swapped-folder': './swappedFolderFileSystem.mjs',
  '?unnamed-real-path': './unnamedRealPathFileSystem.mjs',
  '?crlf-shell': './crlfShellFileSystem.mjs',
  '?large-file-ids': './largeFileIdsFileSystem.mjs',
  '?failing': './failingFileSystem.mjs',
}

/**
 * Resolves `node:fs/promises` to the stand-in of {@link STAND_INS} for a module imported with its mark alone. The modules that module imports in turn carry no mark and keep the real file system, as does every other import. Registered once by the publisher's tests with `module.register`, so a script test can stand in for the file system of a shipped skill module without a flag of the test runner.
 * @param {string} specifier - What the importing module names.
 * @param {{ parentURL?: string }} context - Where the import comes from.
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve - The resolution the stand-in leaves every other import to.
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>} The stand-in's URL for a marked copy's file system, the usual resolution otherwise.
 * @example
 * await resolve('node:fs/promises', { parentURL: 'file:///ext/skills/codebook/publish-wiki.mjs?wrong-look' }, nextResolve) // => { url: 'file:///…/wrongLookFileSystem.mjs', shortCircuit: true }
 */
export async function resolve(specifier, context, nextResolve) {
  const mark = Object.keys(STAND_INS).find((candidate) =>
    context.parentURL?.endsWith(candidate),
  )
  if (specifier === 'node:fs/promises' && mark !== undefined)
    return {
      url: new URL(STAND_INS[mark], import.meta.url).href,
      shortCircuit: true,
    }
  return nextResolve(specifier, context)
}

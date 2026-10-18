/** The mark of a module URL whose `node:fs/promises` is the stand-in of `unnamedRealPathFileSystem.mjs`: a test imports the publisher with it to get a copy of its own. */
const UNNAMED_REAL_PATH_MARK = '?unnamed-real-path'

/**
 * Resolves `node:fs/promises` to the stand-in whose `realpath` fails for the folder a test names, for a module imported with {@link UNNAMED_REAL_PATH_MARK} alone. The modules that module imports in turn carry no mark and keep the real file system, as does every other import. Registered by the publisher's tests with `module.register`, so a script test can meet the shipped publisher with a folder whose real path the system cannot name, without a flag of the test runner.
 * @param {string} specifier - What the importing module names.
 * @param {{ parentURL?: string }} context - Where the import comes from.
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve - The resolution the stand-in leaves every other import to.
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>} The stand-in's URL for the marked copy's file system, the usual resolution otherwise.
 * @example
 * await resolve('node:fs/promises', { parentURL: 'file:///ext/skills/codebook/publish-wiki.mjs?unnamed-real-path' }, nextResolve) // => { url: 'file:///…/unnamedRealPathFileSystem.mjs', shortCircuit: true }
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'node:fs/promises' &&
    context.parentURL?.endsWith(UNNAMED_REAL_PATH_MARK)
  )
    return {
      url: new URL('./unnamedRealPathFileSystem.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  return nextResolve(specifier, context)
}

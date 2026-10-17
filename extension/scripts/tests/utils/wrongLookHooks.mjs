/** The mark of a module URL whose `node:fs/promises` is the stand-in of `wrongLookFileSystem.mjs`: a test imports the publisher with it to get a copy of its own. */
const WRONG_LOOK_MARK = '?wrong-look'

/**
 * Resolves `node:fs/promises` to the stand-in whose `lstat` calls a link a directory, for a module imported with {@link WRONG_LOOK_MARK} alone. The modules that module imports in turn carry no mark and keep the real file system (the publisher's page renderer `render-wiki.mjs` among them), as does every other import. Registered by the publisher's tests with `module.register`, so a script test can stand in for the file system of the shipped publisher without a flag of the test runner.
 * @param {string} specifier - What the importing module names.
 * @param {{ parentURL?: string }} context - Where the import comes from.
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve - The resolution the stand-in leaves every other import to.
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>} The stand-in's URL for the marked copy's file system, the usual resolution otherwise.
 * @example
 * await resolve('node:fs/promises', { parentURL: 'file:///ext/skills/codebook/publish-wiki.mjs?wrong-look' }, nextResolve) // => { url: 'file:///…/wrongLookFileSystem.mjs', shortCircuit: true }
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'node:fs/promises' &&
    context.parentURL?.endsWith(WRONG_LOOK_MARK)
  )
    return {
      url: new URL('./wrongLookFileSystem.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  return nextResolve(specifier, context)
}

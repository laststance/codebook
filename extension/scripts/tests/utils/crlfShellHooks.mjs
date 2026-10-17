/** The mark of a module URL whose `node:fs/promises` is the stand-in of `crlfShellFileSystem.mjs`: a test imports the page renderer with it to get a copy that reads the reader shell with CRLF line endings. */
const CRLF_SHELL_MARK = '?crlf-shell'

/**
 * Resolves `node:fs/promises` to the stand-in that reads the reader shell with CRLF line endings, for a module imported with {@link CRLF_SHELL_MARK} alone. The modules that module imports in turn carry no mark and keep the real file system, as does every other import. Registered by the publisher's tests with `module.register`, so a script test can render pages from a shell as a Windows checkout holds it without a flag of the test runner.
 * @param {string} specifier - What the importing module names.
 * @param {{ parentURL?: string }} context - Where the import comes from.
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve - The resolution the stand-in leaves every other import to.
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>} The stand-in's URL for the marked copy's file system, the usual resolution otherwise.
 * @example
 * await resolve('node:fs/promises', { parentURL: 'file:///ext/skills/codebook/render-wiki.mjs?crlf-shell' }, nextResolve) // => { url: 'file:///…/crlfShellFileSystem.mjs', shortCircuit: true }
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'node:fs/promises' &&
    context.parentURL?.endsWith(CRLF_SHELL_MARK)
  )
    return {
      url: new URL('./crlfShellFileSystem.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  return nextResolve(specifier, context)
}

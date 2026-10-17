import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/**
 * Reads a file as a Windows checkout with `core.autocrlf=true` holds it: the reader shell (`reader-shell.html`) comes with CRLF line endings, as such a checkout writes it and a VSIX packaged from it carries it; every other file is read as it is. The renderer's copy under test gets this module as its `node:fs/promises` ({@link crlfShellHooks}).
 * @param {string | URL} path - The file to read.
 * @param {...unknown} options - The caller's encoding or options, handed on unchanged.
 * @returns {Promise<string | Buffer>} What `readFile` answers, with CRLF line endings for the reader shell read as text.
 * @example
 * (await readFile(new URL('./reader-shell.html', skillUrl), 'utf8')).includes('\r\n') // => true
 */
export async function readFile(path, ...options) {
  const read = await fileSystem.readFile(path, ...options)
  return typeof read === 'string' && String(path).endsWith('reader-shell.html')
    ? read.replace(/\r?\n/g, '\r\n')
    : read
}

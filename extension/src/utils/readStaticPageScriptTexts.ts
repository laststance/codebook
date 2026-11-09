import { readFile, realpath, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'

import {
  STATIC_PAGE_FILE_LIMIT_BYTES,
  STATIC_PAGE_SCRIPT_READS_MAX,
} from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { readStaticPageHtml } from './readStaticPageHtml'
import { resolveStaticPageScriptPath } from './resolveStaticPageScriptPath'

/**
 * Reads the texts of the same-origin script files an entry page names (one level, as readiness does).
 *
 * Why it exists: a page whose `app.js` imports the library from a CDN names no CDN address in its own text, so the library seal must read the scripts too. Called by the `static-page` adapter's library seal.
 * @param folder - The page folder's path.
 * @param entry - The entry file relative to the folder, forward slashes.
 * @param html - The entry page's text.
 * @returns The texts of the readable script files inside the folder, in document order; a remote, missing, linked-out, oversized or unreadable script is skipped.
 * @example await readStaticPageScriptTexts('/repo/examples/page', 'index.html', '<script src="app.js"></script>') // => ['import …']
 */
export async function readStaticPageScriptTexts(
  folder: string,
  entry: string,
  html: string,
): Promise<string[]> {
  const root = await realpath(folder)
  const entryFolder = posix.dirname(entry)
  const texts: string[] = []
  const { scriptSources } = readStaticPageHtml(html)
  for (const source of scriptSources.slice(0, STATIC_PAGE_SCRIPT_READS_MAX)) {
    const relative = resolveStaticPageScriptPath(source, entryFolder)
    if (relative === undefined) continue
    try {
      const real = await realpath(join(root, relative))
      const info = await stat(real)
      if (
        isInsideFolder(root, real) &&
        info.isFile() &&
        info.size <= STATIC_PAGE_FILE_LIMIT_BYTES
      )
        texts.push(await readFile(real, 'utf8'))
    } catch {
      // A script that cannot be read is not one the seal can scan.
    }
  }
  return texts
}

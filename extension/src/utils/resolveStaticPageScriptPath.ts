import { posix } from 'node:path'

import { leavesStaticPageFolder } from './leavesStaticPageFolder'

/** A reference that names something other than a file of the folder: protocol-relative or any scheme. */
const REMOTE_REFERENCE = /^(?:\/\/|[A-Za-z][A-Za-z0-9+.-]*:)/

/**
 * Resolves a `<script src>` of an entry page to a folder-relative file path.
 * Called by {@link readStaticPageScriptTexts} for each script the page names.
 * @param source - The `src` as written.
 * @param entryFolder - The entry file's folder, folder-relative (`.` at the root).
 * @returns The folder-relative path; `undefined` for a remote reference, a malformed percent-encoding or a path that leaves the folder.
 * @example resolveStaticPageScriptPath('app.js?v=1', 'demo') // => 'demo/app.js'
 * @example resolveStaticPageScriptPath('https://cdn.example.test/x.js', '.') // => undefined
 */
export function resolveStaticPageScriptPath(
  source: string,
  entryFolder: string,
): string | undefined {
  if (REMOTE_REFERENCE.test(source)) return undefined
  const bare = source.split(/[?#]/)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURI(bare)
  } catch {
    // A malformed percent-encoding names no file of the folder.
    return undefined
  }
  const relative = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(entryFolder, decoded))
  return relative === '' || leavesStaticPageFolder(relative)
    ? undefined
    : relative
}

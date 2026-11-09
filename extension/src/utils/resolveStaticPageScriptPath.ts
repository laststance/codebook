import { posix } from 'node:path'

import { leavesStaticPageFolder } from './leavesStaticPageFolder'

/** A reference that names something other than a file of the folder: protocol-relative or any scheme. */
const REMOTE_REFERENCE = /^(?:\/\/|[A-Za-z][A-Za-z0-9+.-]*:)/

/**
 * Tells whether a `<base href>` names a remote address, so a relative reference no longer names a file of the folder.
 * Called by {@link resolveStaticPageScriptPath} and the readiness scan.
 * @param baseHref - The page's `<base href>` as written; `undefined` for a page without one.
 * @returns `true` for a scheme-bearing or protocol-relative base.
 * @example isRemoteStaticPageBase('https://cdn.example.test/') // => true
 * @example isRemoteStaticPageBase('sub/') // => false
 */
export function isRemoteStaticPageBase(baseHref: string | undefined): boolean {
  return baseHref !== undefined && REMOTE_REFERENCE.test(baseHref.trim())
}

/**
 * Resolves the folder a page's relative references start from: the entry folder, or the directory of its `<base href>`.
 * Called by {@link resolveStaticPageScriptPath} and the readiness scan.
 * @param baseHref - The page's `<base href>` as written; `undefined` for a page without one. A remote base is the caller's to handle first ({@link isRemoteStaticPageBase}).
 * @param entryFolder - The entry file's folder, folder-relative (`.` at the root).
 * @returns The folder-relative directory; `undefined` for a malformed percent-encoding or a directory that leaves the page folder.
 * @example resolveStaticPageBaseFolder('/sub/', 'demo') // => 'sub'
 * @example resolveStaticPageBaseFolder('sub/page.html', 'demo') // => 'demo/sub'
 */
export function resolveStaticPageBaseFolder(
  baseHref: string | undefined,
  entryFolder: string,
): string | undefined {
  if (baseHref === undefined) return entryFolder
  let decoded: string
  try {
    decoded = decodeURI(baseHref.trim().split(/[?#]/)[0] ?? '')
  } catch {
    // A malformed percent-encoding names no folder of the page.
    return undefined
  }
  // A base names its directory: everything up to the last slash.
  const directory = decoded.slice(0, decoded.lastIndexOf('/') + 1)
  const folder = decoded.startsWith('/')
    ? posix.normalize(directory.slice(1) || '.')
    : posix.normalize(posix.join(entryFolder, directory || '.'))
  return leavesStaticPageFolder(folder) ? undefined : folder
}

/**
 * Resolves a `<script src>` of an entry page to a folder-relative file path.
 * Called by {@link readStaticPageScriptTexts} for each script the page names.
 * @param source - The `src` as written.
 * @param entryFolder - The entry file's folder, folder-relative (`.` at the root).
 * @param baseHref - The page's `<base href>` as written, which a browser resolves relative references against; omit for a page without one.
 * @returns The folder-relative path; `undefined` for a remote reference (or any reference under a remote base), a malformed percent-encoding or a path that leaves the folder.
 * @example resolveStaticPageScriptPath('app.js?v=1', 'demo') // => 'demo/app.js'
 * @example resolveStaticPageScriptPath('app.js', '.', '/sub/') // => 'sub/app.js'
 * @example resolveStaticPageScriptPath('https://cdn.example.test/x.js', '.') // => undefined
 */
export function resolveStaticPageScriptPath(
  source: string,
  entryFolder: string,
  baseHref?: string,
): string | undefined {
  // Under a remote base every non-absolute reference names a remote address.
  if (REMOTE_REFERENCE.test(source) || isRemoteStaticPageBase(baseHref))
    return undefined
  const bare = source.split(/[?#]/)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURI(bare)
  } catch {
    // A malformed percent-encoding names no file of the folder.
    return undefined
  }
  // A root-absolute reference ignores the base; a relative one starts from the base's folder.
  const baseFolder = resolveStaticPageBaseFolder(baseHref, entryFolder)
  if (!decoded.startsWith('/') && baseFolder === undefined) return undefined
  const relative = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(baseFolder ?? entryFolder, decoded))
  return relative === '' || leavesStaticPageFolder(relative)
    ? undefined
    : relative
}

import { posix } from 'node:path'

import { CAPTURED_SOURCE_NAME_PREFIX } from '../constants'

/**
 * Builds the path of a captured-source document's URI for the Study reader's source render: the owner, the learning item, the source hash, then the declared file's own folders and its name behind {@link CAPTURED_SOURCE_NAME_PREFIX}.
 * The folders keep two files of one study that share their name and their bytes (the `page.tsx` of two routes) apart as two documents and tabs, and let {@link capturedSourceDeclaredPath} read the declared path back from a tab.
 * @param location - `owner` is the study id, or `source-derived` for a source no observation or retained capture holds yet; `itemId` is the learning item, encoded into one segment; `hash` is the SHA-256 of the captured bytes; `declaredPath` is the repository-relative path of the stop's file, `undefined` for a source without a declared position, which is then named `fallbackName`.
 * @returns The URI path, starting with a slash.
 * @example
 * capturedSourceUriPath({ owner: 'i_r', itemId: 'repository/book/node', hash: 'ab12', declaredPath: 'app/login/page.tsx', fallbackName: 'node.mts' })
 * // => '/i_r/repository%2Fbook%2Fnode/ab12/app/login/Captured-page.tsx'
 * capturedSourceUriPath({ owner: 'source-derived', itemId: 'repository/workspace/overview', hash: 'ab12', declaredPath: undefined, fallbackName: 'overview.mts' })
 * // => '/source-derived/repository%2Fworkspace%2Foverview/ab12/Captured-overview.mts'
 */
export function capturedSourceUriPath(location: {
  owner: string
  itemId: string
  hash: string
  declaredPath: string | undefined
  fallbackName: string
}): string {
  const { declaredPath } = location
  const folder = declaredPath === undefined ? '.' : posix.dirname(declaredPath)
  const name =
    declaredPath === undefined
      ? location.fallbackName
      : posix.basename(declaredPath)
  // A file at the repository root has no folder segment.
  const folderSegments = folder === '.' ? '' : `/${folder}`
  return `/${location.owner}/${encodeURIComponent(location.itemId)}/${location.hash}${folderSegments}/${CAPTURED_SOURCE_NAME_PREFIX}${name}`
}

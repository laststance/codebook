import { CAPTURED_SOURCE_NAME_PREFIX } from '../constants'

/**
 * Reads the declared repository path back from the path of a captured-source document's URI, for the Study reader's rule that each source file keeps one captured tab.
 * @param uriPath - The `path` of a captured-source URI as {@link capturedSourceUriPath} builds it.
 * @returns The declared path (for a source without a declared position, the name it was given); `undefined` for a Node test history source, whose URI names no declared file, and for a path that is not a captured source's.
 * @example
 * capturedSourceDeclaredPath('/i_r/repository%2Fbook%2Fnode/ab12/app/login/Captured-page.tsx') // => 'app/login/page.tsx'
 * capturedSourceDeclaredPath('/node-history/i_r/3/ab12/Captured-data.ts') // => undefined
 */
export function capturedSourceDeclaredPath(
  uriPath: string,
): string | undefined {
  // After the owner, the item and the hash come the declared file's folders and its prefixed name.
  const [owner, , , ...location] = uriPath
    .split('/')
    .filter((segment) => segment !== '')
  const name = location.at(-1)
  if (
    owner === undefined ||
    owner === 'node-history' ||
    !name?.startsWith(CAPTURED_SOURCE_NAME_PREFIX)
  )
    return undefined
  return [
    ...location.slice(0, -1),
    name.slice(CAPTURED_SOURCE_NAME_PREFIX.length),
  ].join('/')
}

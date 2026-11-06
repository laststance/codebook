import { HTTP_METHOD_NAMES } from '../constants'

import { blankCommentsAndTemplates } from './blankCommentsAndTemplates'

/** `export { a, b as POST }` and `export { a as POST } from '…'` lists; the `from` form re-exports a function that is not in this file. */
const EXPORT_LIST = /\bexport\s*\{([^}]*)\}(\s*from\b)?/g
/** `export [async] function NAME` and `export const|let|var NAME` of a route handler. */
const EXPORT_DECLARATION =
  /\bexport\s+(?:async\s+function\s*\*?|function\s*\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/g

/**
 * Maps the local function names of a route file to the HTTP methods they are exported as, so a hit in an aliased handler (`export { readTodos as GET }`) is still tied to its method.
 * Why it exists: the handler frame carries the local function name, and only the source text says which methods that name serves. Called by {@link ConfiguredBrowserRun} when it judges a route-handler hit.
 * @param sourceText - The route file's source.
 * @returns The methods per local name, in export order; names that serve no HTTP method are absent.
 * @example
 * routeHandlerMethodsOf('export { handle as POST, handle as PUT }')
 * // => Map { 'handle' => ['POST', 'PUT'] }
 */
export function routeHandlerMethodsOf(
  sourceText: string,
): Map<string, string[]> {
  const code = blankCommentsAndTemplates(sourceText)
  const methods = new Map<string, string[]>()
  const add = (local: string, method: string): void => {
    if (!(HTTP_METHOD_NAMES as readonly string[]).includes(method)) return
    const known = methods.get(local) ?? []
    if (!known.includes(method)) methods.set(local, [...known, method])
  }
  for (const match of code.matchAll(EXPORT_DECLARATION))
    add(match[1]!, match[1]!)
  for (const match of code.matchAll(EXPORT_LIST)) {
    // A re-export names a function of another file, which this file's frames never carry.
    if (match[2]) continue
    for (const item of match[1]!.split(',')) {
      const [local, exported] = item.trim().split(/\s+as\s+/)
      if (local) add(local, exported ?? local)
    }
  }
  return methods
}

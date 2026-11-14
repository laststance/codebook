import { REACT_SERVER_COPY_URL_PREFIX } from '../constants'

import { isReactServerCopyUrl } from './isReactServerCopyUrl'
import { parseDevelopmentModuleUrl } from './parseDevelopmentModuleUrl'

/**
 * Reads which module one of React's fabricated server-module copies stands for: the path from the application's root inside the copy's address (`about://React/Server/webpack-internal:///(rsc)/./<path>?<n>`).
 * {@link ConfiguredBrowserRun} asks it for a page pause, to give a pause in React's copy of a declared stop's module the bound of a pause the run resumes itself instead of the short bound of a pause nobody owns (Cycle 0136, F2).
 * @param scriptUrl - The address the page's runtime announced for the paused script; `undefined` for a script it never announced.
 * @returns The module's path without `./`, query or fragment; `undefined` for an address that is no React server copy or whose inner address is no development module's.
 * @example
 * reactServerCopyModulePath('about://React/Server/webpack-internal:///(rsc)/./app/ui/invoices/table.tsx?107') // => 'app/ui/invoices/table.tsx'
 * reactServerCopyModulePath('webpack-internal:///(rsc)/./app/ui/invoices/table.tsx')                         // => undefined
 * reactServerCopyModulePath('about://React/Server/file:///app/ui/table.tsx?3')                                // => undefined
 */
export function reactServerCopyModulePath(
  scriptUrl: string | undefined,
): string | undefined {
  // Only a copy's address carries a module address after the prefix.
  if (scriptUrl === undefined || !isReactServerCopyUrl(scriptUrl))
    return undefined
  return parseDevelopmentModuleUrl(
    scriptUrl.slice(REACT_SERVER_COPY_URL_PREFIX.length),
  )?.path
}

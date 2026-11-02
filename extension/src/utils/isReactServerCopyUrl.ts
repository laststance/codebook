import { REACT_SERVER_COPY_URL_PREFIX } from '../constants'

/**
 * Says whether a script address is one of React's fabricated server-module copies (`about://React/Server/webpack-internal:///(rsc)/./…?<n>`), which js-debug also binds an editor breakpoint in (spike finding F1).
 * Called by {@link ConfiguredBrowserRun} to tell a copy hit from the real module's first hit.
 * @param scriptUrl - A paused script's address, if known.
 * @returns `true` for an address that starts with the copies' prefix.
 * @example
 * isReactServerCopyUrl('about://React/Server/webpack-internal:///(rsc)/./app/ui/table.tsx?107') // => true
 * isReactServerCopyUrl('webpack-internal:///(rsc)/./app/ui/table.tsx') // => false
 */
export function isReactServerCopyUrl(scriptUrl: string | undefined): boolean {
  return scriptUrl?.startsWith(REACT_SERVER_COPY_URL_PREFIX) ?? false
}

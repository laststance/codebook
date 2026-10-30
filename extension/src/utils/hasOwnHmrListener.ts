/** The `server.hmr` and `server.ws` keys that give Vite's websocket a listener of its own, apart from the dev server's port. */
const OWN_LISTENER_KEYS = ['port', 'host', 'server']

/**
 * Tells whether a resolved Vite `server.hmr` or `server.ws` opens a second listener that Codebook does not own, so the launcher can report it among the unsupported settings.
 *
 * Vite resolves `server.hmr` (and in Vite 8 `server.ws`, which opens its own websocket listener even when `hmr` is `false`) to an object whose `port`, `host` and `server` keys may be present with an `undefined` value; only a key with an actual value means its own listener. Called by the Vite launcher module (`viteLauncher.ts`) when it reports `server.config`'s facts.
 *
 * @param hmr - The resolved `server.hmr` or `server.ws` value (`true`, `false`, an object or absent).
 * @returns
 * - `true` when `port`, `host` or `server` holds a value
 * - `false` for `true`, `false`, an absent value or an object without such a value
 * @example
 * hasOwnHmrListener({ port: undefined, host: undefined, overlay: true }) // => false
 * hasOwnHmrListener({ port: 24678 }) // => true
 * hasOwnHmrListener(false) // => false (`server.ws: false`)
 */
export function hasOwnHmrListener(hmr: unknown): boolean {
  // A boolean or an absent hmr keeps the websocket on the dev server's own port.
  if (typeof hmr !== 'object' || hmr === null) return false
  return Object.entries(hmr).some(
    ([key, value]) =>
      OWN_LISTENER_KEYS.includes(key) && value !== undefined && value !== null,
  )
}

import { isViteScriptOfModule } from './isViteScriptOfModule'

/**
 * Tells whether a script a browser announced is the Metro bundle sealed at an owned-origin address: same loopback port, path and query, whichever loopback spelling the browser used.
 *
 * Why it exists: Metro's bundle address carries its build options in the query (`platform`, `dev`, `modulesOnly`, ...), and a different query is a different bundle, so unlike {@link isViteScriptOfModule} (which this narrows: loopback host, port, path and the fragment rule are its) no parameter is ignored. Only the fragment and the loopback spelling (`127.0.0.1` sealed, `localhost` opened) may differ. Called by the Expo adapter for every script the debugger parses.
 *
 * @param sealedUrl - The address the bundle was sealed at.
 * @param announcedUrl - The script URL the browser's debugger announced.
 * @returns `true` when both are loopback addresses of the same port, path and query.
 * @example
 * isExpoWebScriptOfModule('http://127.0.0.1:8081/index.bundle?platform=web&dev=true', 'http://localhost:8081/index.bundle?platform=web&dev=true') // => true
 * isExpoWebScriptOfModule('http://127.0.0.1:8081/index.bundle?platform=web&dev=true', 'http://localhost:8081/index.bundle?platform=web&dev=false') // => false
 */
export function isExpoWebScriptOfModule(
  sealedUrl: string,
  announcedUrl: string,
): boolean {
  if (!isViteScriptOfModule(sealedUrl, announcedUrl)) return false
  // Both URLs parsed already inside the Vite check, so this cannot throw; the query must match as written.
  return new URL(announcedUrl).search === new URL(sealedUrl).search
}

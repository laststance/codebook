/**
 * Writes a pathname the way a browser reports `location.pathname` (non-ASCII characters percent-encoded as UTF-8, existing escapes kept) and removes one trailing slash, so `/login/` and `/login` name the same sign-in route; `/` stays `/`.
 *
 * It exists so the configuration schema (which refuses a repeated sign-in path, and an entry path that is one) and the run (which compares `location.pathname` with each declared path) normalize a path the same way: a declared `/ログイン` and the page's `/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3` are one route.
 * Called by `validateOperations` in the repository configuration schemas and by the run's sign-in path match ({@link matchSignInPath}).
 *
 * @param pathname - A pathname without a query or fragment, starting with `/`; anything else is only stripped of one trailing slash.
 * @returns The encoded pathname without one trailing slash, unless it is `/`.
 *
 * @example
 * ```ts
 * normalizedSignInPathname('/login/') // => '/login'
 * normalizedSignInPathname('/') // => '/'
 * normalizedSignInPathname('/ログイン') // => '/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3'
 * normalizedSignInPathname('//x/login') // => '//x/login'
 * ```
 */
export function normalizedSignInPathname(pathname: string): string {
  let encoded = pathname
  // The path is written after a fixed origin, never resolved against one, so a leading `//` stays a path and is not read as a host.
  if (pathname.startsWith('/'))
    try {
      encoded = new URL(`http://codebook.invalid${pathname}`).pathname
    } catch {
      encoded = pathname
    }
  return encoded.length > 1 && encoded.endsWith('/')
    ? encoded.slice(0, -1)
    : encoded
}

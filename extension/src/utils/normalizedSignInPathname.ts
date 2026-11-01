/**
 * Removes one trailing slash from a pathname, so `/login/` and `/login` name the same sign-in route; `/` stays `/`.
 *
 * It exists so the configuration schema (which refuses a repeated sign-in path, and an entry path that is one) and the run (which compares `location.pathname` with each declared path) normalize a path the same way.
 * Called by `validateOperations` in the repository configuration schemas and by the run's sign-in path match.
 *
 * @param pathname - A pathname without a query or fragment.
 * @returns The pathname without one trailing slash, unless it is `/`.
 *
 * @example
 * ```ts
 * normalizedSignInPathname('/login/') // => '/login'
 * normalizedSignInPathname('/') // => '/'
 * ```
 */
export function normalizedSignInPathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
}

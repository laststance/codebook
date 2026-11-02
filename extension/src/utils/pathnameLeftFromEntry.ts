import { nextPathnameOf } from './nextPathnameOf'

/**
 * Names the path a committed document is on when it is not the entry path, for the entry-load phase's redirect check.
 * Called by the configured browser run when the main frame commits a document while the entry page loads.
 * @param committedUrl - The URL the main frame committed.
 * @param entryPath - The configured entry path (a query does not decide).
 * @returns The committed document's pathname when it differs from the entry path; `undefined` when it is the entry path or the URL names no page.
 * @example
 * pathnameLeftFromEntry('http://localhost:3000/login?next=%2F', '/dashboard') // => '/login'
 * pathnameLeftFromEntry('http://localhost:3000/dashboard/?x=1', '/dashboard') // => undefined
 */
export function pathnameLeftFromEntry(
  committedUrl: string,
  entryPath: string,
): string | undefined {
  // A string that is no absolute URL names no page.
  if (!URL.canParse(committedUrl)) return undefined
  const { pathname } = new URL(committedUrl)
  return nextPathnameOf(pathname) === nextPathnameOf(entryPath)
    ? undefined
    : pathname
}

import { realpath } from 'node:fs/promises'

/**
 * Resolves a path to its real path and rejects when it cannot be resolved; called by {@link selectDevinDescriptor} as the scan's resolver, so a scan can tell a failed lookup from an answer (unlike {@link realOrSame}, which hides the failure).
 * @param path - A workspace path as a descriptor names it.
 * @returns The real path.
 * @throws When the path does not resolve (for example a closed folder or a broken link).
 * @example
 * await resolveRealPath('/tmp/link-to-repo') // => '/private/tmp/repo'
 */
export function resolveRealPath(path: string): Promise<string> {
  return realpath(path)
}

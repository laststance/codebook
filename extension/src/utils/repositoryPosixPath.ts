import { relative, sep } from 'node:path'

/**
 * Writes a path inside the opened repository the way node-test's sentences, manifest and Vitest filter name it: relative to a folder, with `/` on every system, and `.` for the folder itself.
 * Called by the Vitest root's resolver, the execution plan (also for the filter relative to a Vitest root) and the readiness search, whose words reach the agent.
 * @param root - The real folder the path is written relative to: the repository's root, or a test's Vitest root.
 * @param path - A real path inside the root, or the root itself.
 * @returns The root-relative POSIX path, or `.` for the root.
 * @example
 * repositoryPosixPath('/repo', '/repo/packages/query-core') // => 'packages/query-core'
 * repositoryPosixPath('/repo', '/repo')                     // => '.'
 */
export function repositoryPosixPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/') || '.'
}

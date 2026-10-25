import { relative, sep } from 'node:path'

/**
 * Writes a path inside the opened repository the way node-test's sentences and manifest name it: relative to the root, with `/` on every system, and `.` for the root itself.
 * Called by the Vitest root's resolver, the execution plan and the readiness search, whose words reach the agent.
 * @param root - The repository's real root.
 * @param path - A real path inside the root, or the root itself.
 * @returns The root-relative POSIX path, or `.` for the root.
 * @example
 * repositoryPosixPath('/repo', '/repo/packages/query-core') // => 'packages/query-core'
 * repositoryPosixPath('/repo', '/repo')                     // => '.'
 */
export function repositoryPosixPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/') || '.'
}

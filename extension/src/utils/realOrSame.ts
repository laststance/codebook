import { realpath } from 'node:fs/promises'

/**
 * Resolves a path to its real path, or keeps it when it cannot be resolved (for example a closed folder); called by {@link selectDevinDescriptor} and {@link readBridgeDescriptor} so both compare workspaces by the same rule.
 * @param path - A folder path as a descriptor or a bridge's working folder names it.
 * @returns The real path, or `path` unchanged when it does not resolve.
 * @example
 * await realOrSame('/tmp/link-to-repo') // => '/private/tmp/repo'
 * await realOrSame('/closed/folder')     // => '/closed/folder'
 */
export async function realOrSame(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

import { isAbsolute } from 'node:path'

import type { ViteLauncherLibraryOptions } from '../viteLauncherProtocol'

/**
 * Tells whether a value is a well-formed `library` option of the owned Vite launcher.
 *
 * Why it exists: the options arrive as one JSON command-line argument and the launcher builds a plugin and server settings from them, so a malformed field must fail before the server is created. Called by the Vite launcher module (`viteLauncher.ts`) when its options declare `library`.
 *
 * @param value - The parsed `library` option.
 * @returns `true` when the name is a non-empty string, `packedRoot`, `anchorFile`, `libraryRoot` and `privateFolder` are absolute paths, `peers` an array of strings and `imports` absent or a plain object.
 * @example
 * isViteLauncherLibraryOptions({ packageName: 'lib', packedRoot: '/p/node_modules/lib', anchorFile: '/p/codebook-anchor.js', libraryRoot: '/r/lib', peers: [], privateFolder: '/p' }) // => true
 * isViteLauncherLibraryOptions({ packageName: '' }) // => false
 */
export function isViteLauncherLibraryOptions(
  value: unknown,
): value is ViteLauncherLibraryOptions {
  if (typeof value !== 'object' || value === null) return false
  const {
    packageName,
    packedRoot,
    anchorFile,
    libraryRoot,
    privateFolder,
    peers,
    imports,
  } = value as Record<string, unknown>
  const isAbsolutePath = (path: unknown): boolean =>
    typeof path === 'string' && isAbsolute(path)
  return (
    typeof packageName === 'string' &&
    packageName !== '' &&
    [packedRoot, anchorFile, libraryRoot, privateFolder].every(
      isAbsolutePath,
    ) &&
    Array.isArray(peers) &&
    peers.every((peer) => typeof peer === 'string') &&
    (imports === undefined ||
      (typeof imports === 'object' &&
        imports !== null &&
        !Array.isArray(imports)))
  )
}

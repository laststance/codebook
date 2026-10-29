import { realpathSync } from 'node:fs'
import { normalize } from 'node:path'

/**
 * Names a file path in one canonical form so two spellings of the same file compare equal.
 *
 * The real path is used when it resolves (symlinked workspace roots, `/var` vs `/private/var`), else the given path; then it is normalized, and lowercased on macOS and Windows, whose volumes ignore case (and where the editor lowercases a drive letter in `fsPath`).
 * Called by {@link StudyWorkspace}'s Application lease to match a run's stop files against the editor's tab documents ({@link ExtensionViewportIdentity}).
 *
 * @param fsPath - An absolute file path, as the run resolved it or as the editor reports it.
 * @param platform - The platform whose case rule applies; the host's by default.
 * @returns The canonical form, for equality checks only.
 * @example
 * ```ts
 * canonicalFsPath('/tmp/link/settings.js') === canonicalFsPath('/private/tmp/real/settings.js') // true when link points at real
 * ```
 */
export function canonicalFsPath(
  fsPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let resolved = fsPath
  try {
    resolved = realpathSync.native(fsPath)
  } catch {
    // A file that does not resolve keeps the given path.
  }
  const normalized = normalize(resolved)
  return platform === 'darwin' || platform === 'win32'
    ? normalized.toLowerCase()
    : normalized
}

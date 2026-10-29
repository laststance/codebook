import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { StudyError, type ErrorCode } from '../errors'

import { isInsideFolder } from './isInsideFolder'

/**
 * Resolves a path declared relative to the extension root to the file's real path, refusing a path that leaves the root, by name or through a link, or that does not exist.
 * Called by {@link resolveChromeExtensionRun} for the surface page and every stop file.
 * @param options.extensionRoot - The extension root's canonical path.
 * @param options.relativePath - The declared path (an absolute path or `..` is refused as leaving the root).
 * @param options.field - The field named in the refusal, for example `configuration.stops[0].path`.
 * @param options.code - The refusal code; `INVALID_CONFIGURATION` unless a manifest declaration is checked.
 * @returns The file's canonical absolute path.
 * @throws `StudyError` "`<field> must stay inside the extension root.`" or "`<field> does not exist: <path>.`".
 * @example
 * await resolveExtensionFile({ extensionRoot: '/repo/ext', relativePath: 'popup/popup.js', field: 'configuration.stops[0].path' }) // => '/repo/ext/popup/popup.js'
 */
export async function resolveExtensionFile(options: {
  extensionRoot: string
  relativePath: string
  field: string
  code?: ErrorCode
}): Promise<string> {
  const {
    extensionRoot,
    relativePath,
    field,
    code = 'INVALID_CONFIGURATION',
  } = options
  const outside = new StudyError(
    code,
    `${field} must stay inside the extension root.`,
  )
  // An absolute path is no extension-relative path, even when it points inside the root.
  if (isAbsolute(relativePath)) throw outside
  const lexical = resolve(extensionRoot, relativePath)
  if (!isInsideFolder(extensionRoot, lexical)) throw outside
  const real = await realpath(lexical).catch(() => undefined)
  if (real === undefined)
    throw new StudyError(code, `${field} does not exist: ${relativePath}.`)
  // A link inside the root may still lead out of it.
  if (!isInsideFolder(extensionRoot, real)) throw outside
  return real
}

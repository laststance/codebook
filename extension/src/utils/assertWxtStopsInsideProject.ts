import { isAbsolute, resolve } from 'node:path'

import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'

import { createExtensionBuildError } from './createExtensionBuildError'
import { isInsideFolder } from './isInsideFolder'

/**
 * Refuses, before any build starts, a `wxt-build` stop whose path leaves the project folder by name (an absolute path or `..`).
 * Called by the `wxt-build` extension source after the project root resolved; a path that merely lies in `node_modules` was refused by the configuration schema already.
 * @param projectRoot - The project folder's real path.
 * @param stops - The declared stops.
 * @throws `EXTENSION_BUILD_UNSUPPORTED` with reason `stop-outside-project`, `details.field` naming `configuration.stops[i].path`; nothing started.
 * @example
 * assertWxtStopsInsideProject('/repo/ext', [{ path: '../other/a.ts', line: 1, context: 'page' }]) // throws
 */
export function assertWxtStopsInsideProject(
  projectRoot: string,
  stops: ChromeExtensionConfiguration['stops'],
): void {
  stops.forEach((stop, position) => {
    const lexical = resolve(projectRoot, stop.path)
    if (!isAbsolute(stop.path) && isInsideFolder(projectRoot, lexical)) return
    const field = `configuration.stops[${position}].path`
    throw createExtensionBuildError(
      'EXTENSION_BUILD_UNSUPPORTED',
      'stop-outside-project',
      `${field} must be a source file inside the project folder, outside node_modules.`,
      { field },
    )
  })
}

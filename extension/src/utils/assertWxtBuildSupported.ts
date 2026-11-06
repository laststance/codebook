import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { MIN_NODE_MAJOR_VERSION, WXT_SUPPORTED_MAJOR_MINOR } from '../constants'
import type { StudyError } from '../errors'

import { createExtensionBuildError } from './createExtensionBuildError'
import { listTrackedFiles } from './listTrackedFiles'
import { readInstalledWxtVersion } from './readInstalledWxtVersion'
import type { WxtBuildInput } from './wxtBuildTypes'

const WXT_CONFIG_NAMES = [
  'wxt.config.ts',
  'wxt.config.mts',
  'wxt.config.js',
  'wxt.config.mjs',
]

/** Raises the refusal of a `wxt-build` run that cannot start: nothing started, so the build did not run and Chrome did not start. */
function refuse(
  reason: string,
  sentence: string,
  details: Record<string, unknown> = {},
): StudyError {
  return createExtensionBuildError(
    'EXTENSION_BUILD_UNSUPPORTED',
    reason,
    sentence,
    details,
  )
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/**
 * Checks everything that can be known before the WXT build process starts, and refuses with `EXTENSION_BUILD_UNSUPPORTED` and a `details.reason` when one fails.
 * Called first by {@link buildWxtExtension}; nothing is spawned or written when it throws.
 * @param input - The build input: roots and the resolved external Node.
 * @returns The installed WXT version (a `0.21.x` release).
 * @throws `StudyError` `EXTENSION_BUILD_UNSUPPORTED` with reason `no-wxt-config`, `wxt-not-installed`, `wxt-version`, `node-version` or `wxt-dir-tracked`, checked in that order.
 * @example
 * await assertWxtBuildSupported(input) // => '0.21.4'
 */
export async function assertWxtBuildSupported(
  input: Pick<WxtBuildInput, 'repositoryRoot' | 'projectRoot' | 'node'>,
): Promise<string> {
  const hasConfig = (
    await Promise.all(
      WXT_CONFIG_NAMES.map((name) => exists(join(input.projectRoot, name))),
    )
  ).some(Boolean)
  if (!hasConfig)
    throw refuse(
      'no-wxt-config',
      '`extensionRoot` holds no wxt.config.ts, .mts, .js or .mjs.',
    )
  const wxtVersion = await readInstalledWxtVersion(input.projectRoot)
  if (wxtVersion === undefined)
    throw refuse(
      'wxt-not-installed',
      "WXT is not installed for `extensionRoot`; install the project's dependencies.",
    )
  // Release versions only: a prerelease such as 0.21.0-beta.1 does not match.
  if (
    !new RegExp(
      `^${WXT_SUPPORTED_MAJOR_MINOR.replace('.', '\\.')}\\.\\d+$`,
    ).test(wxtVersion)
  )
    throw refuse(
      'wxt-version',
      `This version builds WXT ${WXT_SUPPORTED_MAJOR_MINOR} only; the project has ${wxtVersion}.`,
      { version: wxtVersion },
    )
  const nodeMajor = Number(input.node?.version.split('.')[0])
  if (
    !input.node ||
    !Number.isInteger(nodeMajor) ||
    nodeMajor < MIN_NODE_MAJOR_VERSION
  )
    throw refuse(
      'node-version',
      `The WXT build needs an external Node ${MIN_NODE_MAJOR_VERSION} or later; it is ${input.node?.version ?? 'none'}.`,
      { nodeVersion: input.node?.version ?? 'none' },
    )
  const trackedWxt = await listTrackedFiles(
    input.repositoryRoot,
    join(input.projectRoot, '.wxt'),
  )
  if (trackedWxt.length > 0)
    throw refuse(
      'wxt-dir-tracked',
      "WXT's `.wxt` folder is tracked by Git, and a build would rewrite it.",
    )
  return wxtVersion
}

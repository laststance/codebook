import { resolve } from 'node:path'

import type * as Constants from '../../constants'
import * as runtimeConstants from '../../runtimeSupport/constants'

import { loadModule } from './loadModule'

/** The runtime bounds a test may replace: the active-progress bound and the capture bound. */
export type RuntimeConstantOverrides = Partial<
  Record<
    keyof Pick<
      typeof runtimeConstants,
      'ACTIVE_TIMEOUT_MS' | 'CAPTURE_TIMEOUT_MS'
    >,
    number
  >
>

/**
 * Evaluates the product's `constants` module again over replaced runtime bounds, for a harness that loads a module with {@link loadModule}.
 * The module is evaluated, not copied, so every constant it derives from a replaced bound follows it; a test can then make two bounds equal, or move one, and see which behavior depends on the value.
 * @param overrides - The runtime bounds to replace; every other one keeps its value.
 * @returns The dependencies to hand to {@link loadModule}: the loaded module's `./constants` and `./runtimeSupport/constants`.
 * @example
 * await loadModule(path, { vscode, ...(await loadConstantsWith({ ACTIVE_TIMEOUT_MS: 300_000 })) })
 */
export async function loadConstantsWith(
  overrides: RuntimeConstantOverrides,
): Promise<Record<string, unknown>> {
  const replacedRuntimeConstants = { ...runtimeConstants, ...overrides }
  const constants = await loadModule<typeof Constants>(
    resolve(__dirname, '../../constants.js'),
    { './runtimeSupport/constants': replacedRuntimeConstants },
  )
  return {
    './constants': constants,
    './runtimeSupport/constants': replacedRuntimeConstants,
  }
}

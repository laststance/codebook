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
> & {
  /** Replaces the Next library run's wait for the preload's `wrapped` lines in the loaded module's `./constants` only. */
  NEXT_LIBRARY_WRAPPED_WAIT_MS?: number
}

/**
 * Evaluates the product's `constants` module again over replaced runtime bounds, for a harness that loads a module with {@link loadModule}.
 * The module is evaluated, not copied, so every constant it derives from a replaced bound follows it; a test can then make two bounds equal, or move one, and see which behavior depends on the value.
 * The replacement reaches the module the harness loads and nothing below it: every module that one requires (the owned breakpoint, `waitUntil`) loads the real constants through the real `require` and keeps the real bound.
 * @param overrides - The runtime bounds to replace; every other one keeps its value.
 * @returns The dependencies to hand to {@link loadModule}: the loaded module's `./constants` and `./runtimeSupport/constants`.
 * @example
 * await loadModule(path, { vscode, ...(await loadConstantsWith({ ACTIVE_TIMEOUT_MS: 300_000 })) })
 */
export async function loadConstantsWith(
  overrides: RuntimeConstantOverrides,
): Promise<Record<string, unknown>> {
  const { NEXT_LIBRARY_WRAPPED_WAIT_MS, ...runtimeOverrides } = overrides
  const replacedRuntimeConstants = { ...runtimeConstants, ...runtimeOverrides }
  const constants = await loadModule<typeof Constants>(
    resolve(__dirname, '../../constants.js'),
    { './runtimeSupport/constants': replacedRuntimeConstants },
  )
  return {
    // A replaced wrapped-line bound is set on a copy of the evaluated exports.
    './constants':
      NEXT_LIBRARY_WRAPPED_WAIT_MS === undefined
        ? constants
        : { ...constants, NEXT_LIBRARY_WRAPPED_WAIT_MS },
    './runtimeSupport/constants': replacedRuntimeConstants,
  }
}

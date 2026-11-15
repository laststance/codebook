import { resolve } from 'node:path'

import type * as Constants from '../../constants'
import * as runtimeConstants from '../../runtimeSupport/constants'

import { loadModule } from './loadModule'

/** The runtime bounds a test may replace: the active-progress bound and the capture bound, and two bounds of the loaded module's own constants. */
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
  /** Replaces how long the run holds a page pause for the browser adapter's answer to a server stop's registration, in the loaded module's `./constants` only. */
  BROWSER_STOP_REGISTRATION_ANSWER_MS?: number
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
  const {
    NEXT_LIBRARY_WRAPPED_WAIT_MS,
    BROWSER_STOP_REGISTRATION_ANSWER_MS,
    ...runtimeOverrides
  } = overrides
  const replacedRuntimeConstants = { ...runtimeConstants, ...runtimeOverrides }
  const constants = await loadModule<typeof Constants>(
    resolve(__dirname, '../../constants.js'),
    { './runtimeSupport/constants': replacedRuntimeConstants },
  )
  const copiedOverrides = {
    ...(NEXT_LIBRARY_WRAPPED_WAIT_MS === undefined
      ? {}
      : { NEXT_LIBRARY_WRAPPED_WAIT_MS }),
    ...(BROWSER_STOP_REGISTRATION_ANSWER_MS === undefined
      ? {}
      : { BROWSER_STOP_REGISTRATION_ANSWER_MS }),
  }
  return {
    // A replaced wrapped-line or registration-answer bound is set on a copy of the evaluated exports; without one the module is handed on as evaluated.
    './constants':
      Object.keys(copiedOverrides).length === 0
        ? constants
        : { ...constants, ...copiedOverrides },
    './runtimeSupport/constants': replacedRuntimeConstants,
  }
}

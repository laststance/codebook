import { REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'
import { classNameOf, isCollapsedClassName } from './secretShapes'

/** The name of the Node environment object's holder and of the property that is the environment object: `process.env`. */
const ENVIRONMENT_HOLDER_NAME = 'process'
const ENVIRONMENT_NAME = 'env'

/** Next's preview-mode payload, which `getServerSideProps` receives as `context.previewData`. */
const PREVIEW_DATA_NAME = 'previewData'

/**
 * Says what a debugger variable is saved as when the capture must not read or keep its value or its members, or `undefined` when it is saved normally.
 * Why: one decision for the replay capture (which never reads the children of such a variable) and the saved-snapshot mask (which drops the children an older version saved). Called by {@link captureReplayDebugSnapshot} and {@link maskSavedDebugSnapshot}.
 * - a secret-named variable, and a sibling a neighbour names as secret (`value` beside a secret `name`): {@link REDACTION_MASK}
 * - an instance of a cookie or header store, a socket or a response ({@link isCollapsedClassName}), the environment object reached as `process.env` (V8 reports it as a plain `Object`, so only its path tells), and `previewData`: the class name only
 * @param variable - The variable's name, value preview and debugger type.
 * @param parentName - The name of the variable it is a member of, absent for a scope's own variable.
 * @param isMaskedSibling - Whether {@link findSecretSiblingIndexes} named it.
 * @returns The value to save, or `undefined` for a variable the capture reads and previews as usual.
 * @example
 * withheldVariableValue({ name: 'sessionId', value: "'abc'" }, undefined, false) // => '[masked]'
 * withheldVariableValue({ name: 'socket', value: 'Socket {…}', type: 'Socket' }, 'req', false) // => 'Socket'
 * withheldVariableValue({ name: 'env', value: 'Object', type: 'Object' }, 'process', false) // => 'Object'
 */
export function withheldVariableValue(
  variable: { name: string; value: string; type?: string | undefined },
  parentName: string | undefined,
  isMaskedSibling: boolean,
): string | undefined {
  if (isSecretName(variable.name) || isMaskedSibling) return REDACTION_MASK
  const isEnvironment =
    variable.name === ENVIRONMENT_NAME && parentName === ENVIRONMENT_HOLDER_NAME
  if (
    isEnvironment ||
    variable.name === PREVIEW_DATA_NAME ||
    isCollapsedClassName(variable)
  )
    return classNameOf(variable)
  return undefined
}

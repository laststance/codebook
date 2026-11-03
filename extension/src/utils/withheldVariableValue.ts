import { REDACTION_MASK, SECRET_SHAPE_SCAN_LIMIT_CHARS } from '../constants'

import { boundedClassNameOf } from './boundedClassNameOf'
import { isSecretName } from './isSecretName'
import { isCollapsedClassName } from './secretShapes'

/** The name of the Node environment object's holder and of the property that is the environment object: `process.env`. */
const ENVIRONMENT_HOLDER_NAME = 'process'
const ENVIRONMENT_NAME = 'env'

/** The names under which a script usually keeps the environment object or an alias of it (`const env = process.env`, `const { env } = process`, `const environment = process.env`). */
const ENVIRONMENT_ALIAS_NAMES: ReadonlySet<string> = new Set([
  ENVIRONMENT_NAME,
  'environment',
])

/** Next's preview-mode payload, which `getServerSideProps` receives as `context.previewData`. */
const PREVIEW_DATA_NAME = 'previewData'

/** An environment variable's name: capitals, digits and underscores (`PATH`, `DATABASE_URL`, `__CF_USER_TEXT_ENCODING`). */
const SCREAMING_SNAKE_CASE_NAME = /^_*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

/** What a debugger lists beside an object's own properties: `[[Prototype]]`, `__proto__`. */
const INTERNAL_MEMBER_NAME = /^(?:\[\[.*\]\]|__proto__)$/

/** One key of a preview's `{KEY: …, KEY: …}` list, found after `{` or `,`. */
const PREVIEW_MEMBER_KEY = /[{,]\s*([A-Za-z_$][\w$]*)\s*:/g

/**
 * Tells whether a variable name is one under which the environment object or an alias of it is kept (`env`, `environment`).
 * Called by {@link captureReplayDebugSnapshot} and {@link maskSavedDebugSnapshot} to decide which variables' member names are read for {@link withheldVariableValue}.
 * @param name - A variable's name.
 * @returns `true` for `env` and `environment`.
 * @example
 * isEnvironmentAliasName('env') // => true
 * isEnvironmentAliasName('envelope') // => false
 */
export function isEnvironmentAliasName(name: string): boolean {
  return ENVIRONMENT_ALIAS_NAMES.has(name)
}

/**
 * Tells whether most of the names a variable lists are environment variable names (`PATH`, `DATABASE_URL`).
 * Called by {@link withheldVariableValue} for a variable named `env` or `environment`, which V8 reports as a plain `Object`.
 * @param names - The names of the variable's readable members, or of the keys its preview lists.
 * @returns `true` when more than half of the names, `[[Prototype]]` and `__proto__` left out, are SCREAMING_SNAKE_CASE.
 * @example
 * namesMostlyScreamingSnakeCase(['PATH', 'DATABASE_URL', '__proto__']) // => true
 * namesMostlyScreamingSnakeCase(['host', 'port']) // => false
 */
function namesMostlyScreamingSnakeCase(names: readonly string[]): boolean {
  const readable = names.filter((name) => !INTERNAL_MEMBER_NAME.test(name))
  const screaming = readable.filter((name) =>
    SCREAMING_SNAKE_CASE_NAME.test(name),
  )
  return readable.length > 0 && screaming.length * 2 > readable.length
}

/**
 * Lists the keys a debugger's value preview shows, for a variable whose members are not at hand.
 * Called by {@link withheldVariableValue}.
 * @param preview - A variable's value preview, such as `Object {PATH: '/usr/bin', HOME: '/root'}`.
 * @returns The keys, read from the first {@link SECRET_SHAPE_SCAN_LIMIT_CHARS} characters of the preview.
 * @example previewKeys("Object {PATH: '/usr/bin', HOME: '/root'}") // => ['PATH', 'HOME']
 */
function previewKeys(preview: string): string[] {
  return Array.from(
    preview
      .slice(0, SECRET_SHAPE_SCAN_LIMIT_CHARS)
      .matchAll(PREVIEW_MEMBER_KEY),
    (match) => match[1] ?? '',
  )
}

/**
 * Says what a debugger variable is saved as when the capture must not read or keep its value or its members, or `undefined` when it is saved normally.
 * Why: one decision for the replay capture (which never reads the children of such a variable) and the saved-snapshot mask (which drops the children an older version saved). Called by {@link captureReplayDebugSnapshot} and {@link maskSavedDebugSnapshot}.
 * - a secret-named variable, and a sibling a neighbour names as secret (`value` beside a secret `name`): {@link REDACTION_MASK}
 * - an instance of a cookie or header store, a socket or a response ({@link isCollapsedClassName}), the environment object reached as `process.env` (V8 reports it as a plain `Object`, so only its path tells), a variable named `env` or `environment` whose members are mostly SCREAMING_SNAKE_CASE (an alias of `process.env`), and `previewData`: the class name only
 * @param variable - The variable's name, value preview and debugger type.
 * @param parentName - The name of the variable it is a member of, absent for a scope's own variable.
 * @param isMaskedSibling - Whether {@link findSecretSiblingIndexes} named it.
 * @param childNames - The names of the variable's members, when the caller has read them; a variable named `env` or `environment` without them is judged by the keys its preview lists.
 * @returns The value to save, or `undefined` for a variable the capture reads and previews as usual.
 * @example
 * withheldVariableValue({ name: 'sessionId', value: "'abc'" }, undefined, false) // => '[masked]'
 * withheldVariableValue({ name: 'socket', value: 'Socket {…}', type: 'Socket' }, 'req', false) // => 'Socket'
 * withheldVariableValue({ name: 'env', value: 'Object', type: 'Object' }, 'process', false) // => 'Object'
 * withheldVariableValue({ name: 'env', value: 'Object', type: 'Object' }, undefined, false, ['PATH', 'HOME']) // => 'Object'
 */
export function withheldVariableValue(
  variable: { name: string; value: string; type?: string | undefined },
  parentName: string | undefined,
  isMaskedSibling: boolean,
  childNames?: readonly string[],
): string | undefined {
  if (isSecretName(variable.name) || isMaskedSibling) return REDACTION_MASK
  const isEnvironment =
    variable.name === ENVIRONMENT_NAME && parentName === ENVIRONMENT_HOLDER_NAME
  const isEnvironmentAlias =
    isEnvironmentAliasName(variable.name) &&
    namesMostlyScreamingSnakeCase(
      childNames?.length ? childNames : previewKeys(variable.value),
    )
  if (
    isEnvironment ||
    isEnvironmentAlias ||
    variable.name === PREVIEW_DATA_NAME ||
    isCollapsedClassName(variable)
  )
    return boundedClassNameOf(variable)
  return undefined
}

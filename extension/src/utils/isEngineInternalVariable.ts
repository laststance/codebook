import { REPLAY_DEBUG_ENGINE_INTERNAL_NAMES } from '../constants'

const ENGINE_INTERNAL_NAMES: ReadonlySet<string> = new Set(
  REPLAY_DEBUG_ENGINE_INTERNAL_NAMES,
)

/**
 * Says whether a debugger variable's children are JavaScript engine internals, which the replay capture does not read: a function or class (js-debug types both `function`), or a prototype, closure-scope or function-location member ({@link REPLAY_DEBUG_ENGINE_INTERNAL_NAMES}).
 *
 * Why it exists: at a browser stop most of the capture's serial `variables` requests went into function members and prototype chains, and the capture reached its deadline before it published the pause (C89-D1).
 * Called by {@link captureReplayDebugSnapshot} before it reads a saved variable's children.
 *
 * @param variable - The adapter's variable: its name and its `type`, when the adapter gave one.
 * @returns
 * - `true` for a function-typed variable and for `[[Prototype]]`, `__proto__`, `[[Scopes]]` and `[[FunctionLocation]]`
 * - `false` for every other variable, `[[Entries]]`, `[[Target]]`, `[[Handler]]` and `[[PrimitiveValue]]` included
 * @example
 * isEngineInternalVariable({ name: 'onSuccess', type: 'function' }) // => true
 * isEngineInternalVariable({ name: '[[Prototype]]', type: 'Object' }) // => true
 * isEngineInternalVariable({ name: '[[Entries]]', type: 'Array' }) // => false
 * isEngineInternalVariable({ name: 'parsed', type: 'Object' }) // => false
 */
export function isEngineInternalVariable(variable: {
  name: string
  type?: string | undefined
}): boolean {
  return (
    variable.type === 'function' || ENGINE_INTERNAL_NAMES.has(variable.name)
  )
}

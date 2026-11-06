import {
  REPLAY_DEBUG_ENGINE_INTERNAL_NAMES,
  REPLAY_DEBUG_FUNCTION_TYPES,
} from '../constants'

const ENGINE_INTERNAL_NAMES: ReadonlySet<string> = new Set(
  REPLAY_DEBUG_ENGINE_INTERNAL_NAMES,
)
const FUNCTION_TYPES: ReadonlySet<string> = new Set(REPLAY_DEBUG_FUNCTION_TYPES)

/**
 * Says whether a debugger variable's children are JavaScript engine internals, which the replay capture does not read.
 *
 * Why it exists: at a browser stop most of the capture's serial `variables` requests went into function members and prototype chains, and the capture reached its deadline before it published the pause (C89-D1).
 * Called by {@link captureReplayDebugSnapshot} before it reads a saved variable's children.
 *
 * @param variable - The adapter's variable: its name and its `type`, when the adapter gave one.
 * @returns
 * - `true` for a function or class, which js-debug types by its class name ({@link REPLAY_DEBUG_FUNCTION_TYPES}), and for `[[Prototype]]`, `__proto__`, `[[Scopes]]` and `[[FunctionLocation]]` ({@link REPLAY_DEBUG_ENGINE_INTERNAL_NAMES})
 * - `false` for every other variable: a getter (raw type `function`, whose child is the value it computes), `[[Entries]]`, `[[Target]]`, `[[Handler]]` and `[[PrimitiveValue]]` included
 * @example
 * isEngineInternalVariable({ name: 'onSuccess', type: 'Function' }) // => true
 * isEngineInternalVariable({ name: 'load', type: 'AsyncFunction' }) // => true
 * isEngineInternalVariable({ name: '[[Prototype]]', type: 'Object' }) // => true
 * isEngineInternalVariable({ name: 'total', type: 'function' }) // => false
 * isEngineInternalVariable({ name: '[[Entries]]', type: 'Array' }) // => false
 */
export function isEngineInternalVariable(variable: {
  name: string
  type?: string | undefined
}): boolean {
  return (
    (variable.type !== undefined && FUNCTION_TYPES.has(variable.type)) ||
    ENGINE_INTERNAL_NAMES.has(variable.name)
  )
}

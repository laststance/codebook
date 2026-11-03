import type { Protocol } from 'devtools-protocol'

import {
  configuredFactValueSchema,
  type ConfiguredObservation,
} from '../configuredStudySchemas'
import {
  REPOSITORY_CAPTURED_TYPES,
  REPOSITORY_INSPECTION_TIMEOUT_MS,
  REPOSITORY_LITERAL_LIMIT_CHARS,
} from '../constants'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

import { maskStoredFact } from './maskStoredFact'
import { redactInspectedValue } from './redactInspectedValue'

/** Reason stored for a declared inspection the debugger refused to evaluate; {@link ConfiguredBrowserRun} compares against it to tell the chat that the value is a getter, and how to recover. */
export const INSPECTION_REJECTED_REASON =
  'Evaluation unavailable or rejected for possible side effects.'

/** Reason stored for a declared inspection that evaluated without a bounded primitive at the exact frame. */
export const INSPECTION_UNBOUNDED_REASON =
  'No bounded primitive value is available at this exact frame.'

/** Captures declared bounded facts for {@link ConfiguredBrowserRun}; an object or function is captured as its `{ type }` marker, because its members are not bounded, and explicit unavailability preserves other facts while the caller gates continuation. @param maskKnownText - Masks the values a Vite run learned from its env files in a captured string; the identity for a run without such values. @example await inspectConfiguredValues(evaluate, callFrameId, configuration.inspections, assertCurrent) */
export async function inspectConfiguredValues(
  evaluate: (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ) => Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>,
  callFrameId: string,
  inspections: RepositoryConfiguration['inspections'],
  assertCurrent: () => void,
  maskKnownText: (text: string) => string = (text) => text,
) {
  const values: ConfiguredObservation['values'] = {},
    unavailableValues: ConfiguredObservation['unavailableValues'] = [],
    sideEffectRefused: string[] = []
  for (const inspection of inspections) {
    assertCurrent()
    const path = `${inspection.mode}:${inspection.path}`
    // Tag actual undefined, objects and functions before serialization: an object's members are not bounded, so only a fresh marker crosses the transport and application lookalike tags never do.
    const expression =
      inspection.mode === 'type'
        ? `typeof ${inspection.path}`
        : `((value) => typeof value === 'undefined' ? { type: 'undefined' } : value === null || typeof value === 'boolean' || typeof value === 'number' && value - value === 0 || typeof value === 'string' && value.length <= ${REPOSITORY_LITERAL_LIMIT_CHARS} ? value : typeof value === 'object' || typeof value === 'function' ? { type: typeof value } : void 0)(${inspection.path})`
    const response = await evaluate({
      callFrameId,
      expression,
      returnByValue: true,
      throwOnSideEffect: true,
      timeout: REPOSITORY_INSPECTION_TIMEOUT_MS,
    })
    assertCurrent()
    const value = configuredFactValueSchema.safeParse(response.result.value)
    // Bare missing responses, oversized strings, nonfinite values and thrown/getter/proxy evaluations remain unavailable.
    const available =
      !response.exceptionDetails &&
      !response.result.objectId &&
      !response.result.unserializableValue &&
      value.success &&
      (inspection.mode !== 'type' ||
        REPOSITORY_CAPTURED_TYPES.some((type) => type === value.data))
    if (available && value.success) {
      // Known env-file values are masked by value, beside the name and shape redaction.
      const stored = maskStoredFact(
        redactInspectedValue(inspection, value.data),
        maskKnownText,
      )
      // A mask can be longer than the value it hides: a text grown past the stored bound stays unavailable, so the study still saves.
      if (stored === undefined)
        unavailableValues.push({
          path,
          reason:
            'The value exceeds the stored bound once its secrets are masked.',
        })
      else values[path] = stored
      continue
    }
    // Only V8's own side-effect refusal (a getter or another call under throwOnSideEffect) is told to the chat as a getter; any other throw keeps the plain wording.
    if (isSideEffectRefusal(response.exceptionDetails))
      sideEffectRefused.push(path)
    const reason = response.exceptionDetails
      ? INSPECTION_REJECTED_REASON
      : INSPECTION_UNBOUNDED_REASON
    unavailableValues.push({ path, reason })
  }
  return {
    values,
    unavailableValues,
    ...(sideEffectRefused.length ? { sideEffectRefused } : {}),
  }
}

/**
 * Says whether an evaluation was refused by V8's side-effect check (`throwOnSideEffect`), as opposed to an expression that threw for another reason (a name not in scope, a `TypeError`).
 *
 * Why: only a side-effect refusal means the declared value is a getter or another call Codebook will not run, so only then does the failure advise an optional inspection or a plain value. Called by {@link inspectConfiguredValues} for each unavailable evaluation.
 * @param details - The `exceptionDetails` of a `Debugger.evaluateOnCallFrame` answer, if any.
 * @returns
 * - `true` for V8's `EvalError: Possible side-effect in debug-evaluate`
 * - `false` for no exception or any other one
 * @example isSideEffectRefusal({ exceptionId: 1, text: 'Uncaught', lineNumber: 0, columnNumber: 0, exception: { type: 'object', className: 'EvalError', description: 'EvalError: Possible side-effect in debug-evaluate' } }) // => true
 */
function isSideEffectRefusal(
  details: Protocol.Runtime.ExceptionDetails | undefined,
): boolean {
  const exception = details?.exception
  return (
    exception?.className === 'EvalError' &&
    /possible side-effect/i.test(exception.description ?? '')
  )
}

/**
 * Words the failure of a required inspection that came back unavailable.
 *
 * Why: the chat needs to know whether the debugger refused the value as a possible side effect (a getter, such as a fetch Response's status), because only then does declaring it optional or choosing a plain value recover the run. Called by {@link ConfiguredBrowserRun} when a stop's required inspection is in the facts' unavailable list.
 *
 * @param missing - The required inspection that is unavailable.
 * @param sideEffectRefused - The inspections (`<mode>:<path>`) V8 refused as a possible side effect at this stop, from {@link inspectConfiguredValues}.
 * @param hint - The self-declared-binding hint for the stop's line; when set, it explains the refusal better than the getter text and is appended to the plain message.
 * @returns The failure message.
 * @example requiredInspectionFailureMessage({ mode: 'value', path: 'response.status' }, ['value:response.status'], '')
 */
export function requiredInspectionFailureMessage(
  missing: { mode: string; path: string },
  sideEffectRefused: readonly string[],
  hint: string,
): string {
  const label = `${missing.mode}:${missing.path}`
  const rejected = sideEffectRefused.includes(label)
  // A binding the stop's own line declares is refused the same way, and its hint explains it better.
  if (rejected && hint === '')
    return `Required inspection ${label} is unavailable: Codebook reads values without side effects, and reading it runs a getter (an accessor property, such as a fetch Response's status or a Map's size), which the debugger refused. Declare it as an optional inspection (required: false) or choose a value the code holds in a variable or a plain property, then start one new run; the getter's value can be read in the native debugger state of this observation. Captured facts remain readable.`
  return `Required inspection ${label} is unavailable; captured facts remain readable.${hint}`
}

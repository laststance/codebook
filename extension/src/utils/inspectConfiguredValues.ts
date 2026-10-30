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
    unavailableValues: ConfiguredObservation['unavailableValues'] = []
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
    const reason = response.exceptionDetails
      ? 'Evaluation unavailable or rejected for possible side effects.'
      : 'No bounded primitive value is available at this exact frame.'
    unavailableValues.push({ path, reason })
  }
  return { values, unavailableValues }
}

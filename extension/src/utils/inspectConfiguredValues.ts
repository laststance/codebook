import type { Protocol } from 'devtools-protocol';
import { configuredFactValueSchema, type ConfiguredObservation } from '../configuredStudySchemas';
import type { RepositoryConfiguration } from '../repositoryConfigSchemas';
import { REPOSITORY_CAPTURED_TYPES, REPOSITORY_INSPECTION_TIMEOUT_MS, REPOSITORY_LITERAL_LIMIT_CHARS } from '../constants';

/** Captures declared bounded facts for {@link ConfiguredBrowserRun}; explicit unavailability preserves other facts while the caller gates continuation. @example await inspectConfiguredValues(evaluate, callFrameId, configuration.inspections, assertCurrent) */
export async function inspectConfiguredValues(evaluate: (parameters: Protocol.Debugger.EvaluateOnCallFrameRequest) => Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>, callFrameId: string, inspections: RepositoryConfiguration['inspections'], assertCurrent: () => void) {
  const values: ConfiguredObservation['values'] = {}, unavailableValues: ConfiguredObservation['unavailableValues'] = [];
  for (const inspection of inspections) {
    assertCurrent();
    const path = `${inspection.mode}:${inspection.path}`;
    // Reject objects and oversized strings inside the paused frame, before CDP serializes any application payload.
    const expression = inspection.mode === 'type' ? `typeof ${inspection.path}`
      : `((value) => value === null || typeof value === 'boolean' || typeof value === 'number' && value - value === 0 || typeof value === 'string' && value.length <= ${REPOSITORY_LITERAL_LIMIT_CHARS} ? value : void 0)(${inspection.path})`;
    const response = await evaluate({ callFrameId, expression, returnByValue: true, throwOnSideEffect: true, timeout: REPOSITORY_INSPECTION_TIMEOUT_MS }); assertCurrent();
    const value = configuredFactValueSchema.safeParse(response.result.value);
    // Objects, undefined, oversized strings, nonfinite values and thrown/getter/proxy evaluations remain unavailable.
    const available = !response.exceptionDetails && !response.result.objectId && !response.result.unserializableValue && value.success
      && (inspection.mode !== 'type' || REPOSITORY_CAPTURED_TYPES.some(type => type === value.data));
    if (available && value.success) { values[path] = value.data; continue; }
    const reason = response.exceptionDetails ? 'Evaluation unavailable or rejected for possible side effects.' : 'No bounded primitive value is available at this exact frame.';
    unavailableValues.push({ path, reason });
  }
  return { values, unavailableValues };
}

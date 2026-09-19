import type { Protocol } from 'devtools-protocol';
import { configuredFactValueSchema, type ConfiguredObservation } from '../configuredStudySchemas';
import type { RepositoryConfiguration } from '../repositoryConfigSchemas';
import { REPOSITORY_CAPTURED_TYPES } from '../constants';

/** Captures only declared safe primitive/type results in the selected call frame; required unavailability rejects the entire observation. @example await inspectConfiguredValues(evaluate, callFrameId, configuration.inspections, assertCurrent) */
export async function inspectConfiguredValues(evaluate: (parameters: Protocol.Debugger.EvaluateOnCallFrameRequest) => Promise<Protocol.Debugger.EvaluateOnCallFrameResponse>, callFrameId: string, inspections: RepositoryConfiguration['inspections'], assertCurrent: () => void) {
  const values: ConfiguredObservation['values'] = {}, unavailableValues: ConfiguredObservation['unavailableValues'] = [];
  for (const inspection of inspections) {
    assertCurrent();
    const path = `${inspection.mode}:${inspection.path}`, expression = inspection.mode === 'type' ? `typeof ${inspection.path}` : inspection.path;
    const response = await evaluate({ callFrameId, expression, returnByValue: true, throwOnSideEffect: true }); assertCurrent();
    const value = configuredFactValueSchema.safeParse(response.result.value);
    // Objects, undefined, oversized strings, nonfinite values and thrown/getter/proxy evaluations remain unavailable.
    const available = !response.exceptionDetails && !response.result.objectId && !response.result.unserializableValue && value.success
      && (inspection.mode !== 'type' || REPOSITORY_CAPTURED_TYPES.some(type => type === value.data));
    if (available && value.success) { values[path] = value.data; continue; }
    const reason = response.exceptionDetails ? 'Evaluation unavailable or rejected for possible side effects.' : 'No bounded primitive value is available at this exact frame.';
    if (inspection.required) throw new Error(`Required inspection ${path} is unavailable: ${reason}`);
    unavailableValues.push({ path, reason });
  }
  return { values, unavailableValues };
}

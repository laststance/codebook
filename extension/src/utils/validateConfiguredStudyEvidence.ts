import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { CONFIGURED_OBSERVATION_LIMIT, REPOSITORY_CAPTURED_TYPES } from '../constants';
import type { ConfiguredStudy } from '../configuredStudySchemas';
import { assertConfiguredDescriptor } from './assertConfiguredDescriptor';

/** Validates sealed configured facts for archive and recording readers without requiring current files or granting runtime authority. @example validateConfiguredStudyEvidence(study, workspaceKey) // rejects altered source or pause */
export function validateConfiguredStudyEvidence(study: Omit<ConfiguredStudy, 'captures'>, workspaceKey: string): void {
  const configuration = study.configuration;
  if (study.workspaceKey !== workspaceKey || study.id !== `${study.instanceId}_${study.runId}`) throw new Error('Configured study belongs to a different workspace or run.');
  if (sha256(JSON.stringify(configuration)) !== study.configurationHash) throw new Error('Configured study intent changed.');
  const descriptor = study.descriptor;
  // Preparation failures remain representable without inventing a successfully bound article/source.
  if (!descriptor && (study.observations.length || study.operation || study.finalOutcome === 'demonstrated')) throw new Error('Configured evidence has no bound descriptor.');
  if (descriptor) assertConfiguredDescriptor(configuration, descriptor);
  for (const observation of study.observations) {
    if (!study.operation?.inputDispatched) throw new Error('Configured observation has no dispatched operation.');
    if (observation.itemId !== descriptor?.itemId || observation.id !== `${observation.pause.sessionId}:${observation.pause.generation}` || observation.snapshotUri !== `codebook://${study.instanceId}/runs/${study.runId}/snapshots/${encodeURIComponent(observation.id)}`) throw new Error('Configured observation identity changed.');
    const source = descriptor.sources.find(source => source.path === configuration.source.path);
    if (!source || observation.source.text !== source.text || observation.source.hash !== source.hash || observation.source.line !== configuration.source.line || observation.source.column !== configuration.source.column) throw new Error('Configured observation source differs from its sealed definition.');
    const values = new Map(Object.entries(observation.values)), unavailable = new Map(observation.unavailableValues.map(entry => [entry.path, entry.reason]));
    const declared = new Set(configuration.inspections.map(inspection => `${inspection.mode}:${inspection.path}`));
    if (unavailable.size !== observation.unavailableValues.length || [...values.keys(), ...unavailable.keys()].some(path => !declared.has(path)) || values.size + unavailable.size !== declared.size) throw new Error('Configured captured facts differ from declared inspections.');
    for (const inspection of configuration.inspections) {
      const path = `${inspection.mode}:${inspection.path}`;
      if (values.has(path) === unavailable.has(path)) throw new Error('Configured inspection must have one captured or unavailable result.');
      if (inspection.mode === 'type' && values.has(path) && !REPOSITORY_CAPTURED_TYPES.some(type => type === values.get(path))) throw new Error('Configured type inspection is not a captured type string.');
      // Partial source/value evidence remains readable, but it cannot qualify continuation or completed execution.
      if (inspection.required && unavailable.has(path) && (study.finalOutcome === 'demonstrated' || study.operation?.continuedPause || study.operation?.afterVerified)) throw new Error('Configured completed or continued observation lacks a required fact.');
    }
    for (const interpretation of observation.interpretations) {
      if (new Set(interpretation.facts.map(fact => fact.path)).size !== interpretation.facts.length || interpretation.facts.some(fact => !values.has(fact.path) || values.get(fact.path) !== fact.value)) throw new Error('Configured interpretation facts differ from its observation.');
    }
  }
  const operation = study.operation, observation = study.observations[0];
  if (operation?.inputAcknowledged && !operation.inputDispatched) throw new Error('Configured input acknowledgement precedes dispatch.');
  if (operation?.continuedPause && (!observation || JSON.stringify(operation.continuedPause) !== JSON.stringify(observation.pause))) throw new Error('Configured continuation differs from the captured pause.');
  if (operation?.afterVerified && (!operation.inputAcknowledged || !operation.continuedPause)) throw new Error('Configured after verification lacks confirmed input and continuation.');
  if (study.finalOutcome === 'demonstrated' && (!study.terminal || !operation?.afterVerified || study.observations.length !== CONFIGURED_OBSERVATION_LIMIT)) throw new Error('Configured completed study is missing required evidence.');
}

import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  CONFIGURED_STUDY_VERSION,
  CROSS_RUNTIME_STUDY_VERSION,
  REPOSITORY_CAPTURED_TYPES,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { assertConfiguredDescriptor } from './assertConfiguredDescriptor'
import { configuredStops } from './configuredStops'
import { isSavedSourceAtStop } from './isSavedSourceAtStop'

/** Validates sealed configured facts for archive and recording readers without requiring current files or granting runtime authority. @example validateConfiguredStudyEvidence(study, workspaceKey) // rejects altered source or pause */
export function validateConfiguredStudyEvidence(
  study: Omit<ConfiguredStudy, 'captures'>,
  workspaceKey: string,
): void {
  const configuration = study.configuration
  if (
    study.version !==
    (configuration.version === 1
      ? CONFIGURED_STUDY_VERSION
      : CROSS_RUNTIME_STUDY_VERSION)
  )
    throw new Error('Configured archive and intent versions disagree.')
  if (
    study.workspaceKey !== workspaceKey ||
    study.id !== `${study.instanceId}_${study.runId}`
  )
    throw new Error('Configured study belongs to a different workspace or run.')
  if (sha256(JSON.stringify(configuration)) !== study.configurationHash)
    throw new Error('Configured study intent changed.')
  const descriptor = study.descriptor
  // Preparation failures remain representable without inventing a successfully bound article/source.
  if (
    !descriptor &&
    (study.observations.length ||
      study.operation ||
      study.finalOutcome === 'demonstrated')
  )
    throw new Error('Configured evidence has no bound descriptor.')
  if (descriptor) assertConfiguredDescriptor(configuration, descriptor)
  const stops = configuredStops(configuration)
  if (study.observations.length > stops.length)
    throw new Error('Configured observations exceed the declared stops.')
  const continuedIndex = study.observations.findIndex(
    (observation) =>
      JSON.stringify(observation.pause) ===
      JSON.stringify(study.operation?.continuedPause),
  )
  const sessionOwners = new Map<string, string>(),
    participantSessions = new Map<string, string>(),
    generations = new Map<string, number>()
  for (const [index, observation] of study.observations.entries()) {
    const stop = stops[index]!,
      previous = study.observations[index - 1]
    if (
      observation.participant !== stop.participant ||
      observation.capturePhase !== `paused-${stop.participant}`
    )
      throw new Error(
        'Configured observation changed its declared participant or phase.',
      )
    const session = observation.pause.sessionId,
      participant = observation.participant
    if (
      (previous && previous.elapsedMs > observation.elapsedMs) ||
      (generations.get(session) ?? 0) >= observation.pause.generation
    )
      throw new Error(
        'Configured observations changed their ordered pause identities.',
      )
    if (
      (sessionOwners.has(session) &&
        sessionOwners.get(session) !== participant) ||
      (participantSessions.has(participant) &&
        participantSessions.get(participant) !== session)
    )
      throw new Error(
        'Configured participant changed its owned debugger session.',
      )
    sessionOwners.set(session, participant)
    participantSessions.set(participant, session)
    generations.set(session, observation.pause.generation)
    if (!study.operation?.inputDispatched)
      throw new Error('Configured observation has no dispatched operation.')
    if (
      observation.itemId !== descriptor?.itemId ||
      observation.id !==
        `${observation.pause.sessionId}:${observation.pause.generation}` ||
      observation.snapshotUri !==
        `codebook://${study.instanceId}/runs/${study.runId}/snapshots/${encodeURIComponent(observation.id)}`
    )
      throw new Error('Configured observation identity changed.')
    const source = descriptor.sources.find(
      (source) => source.path === stop.source.path,
    )
    if (
      !source ||
      observation.source.text !== source.text ||
      observation.source.hash !== source.hash ||
      // The debugger chooses the position: another column of the declared line, or a later line within the stop's citation. A position other than the declared one is kept only when the saved native top frame confirms it, which the debugger check below requires.
      !isSavedSourceAtStop(
        observation.source,
        Boolean(observation.debugger),
        stop.source,
        descriptor.anchors[stop.anchorIndex],
      )
    )
      throw new Error(
        'Configured observation source differs from its sealed definition.',
      )
    if (
      study.version === CROSS_RUNTIME_STUDY_VERSION &&
      study.finalOutcome === 'demonstrated' &&
      !observation.debugger
    )
      throw new Error(
        'Completed cross-runtime history lacks native debugger state.',
      )
    if (observation.debugger) {
      const top = observation.debugger.frames[0]
      if (
        !top?.source ||
        top.source.text !== source.text ||
        top.source.hash !== source.hash ||
        top.source.name !== stop.source.path ||
        top.line !== observation.source.line ||
        top.column !== observation.source.column
      )
        throw new Error(
          'Historical debugger differs from its verified source stop.',
        )
      for (const frame of observation.debugger.frames)
        if (frame.source && sha256(frame.source.text) !== frame.source.hash)
          throw new Error('Historical debugger source hash changed.')
    }
    const values = new Map(Object.entries(observation.values)),
      unavailable = new Map(
        observation.unavailableValues.map((entry) => [
          entry.path,
          entry.reason,
        ]),
      )
    const declared = new Set(
      stop.inspections.map(
        (inspection) => `${inspection.mode}:${inspection.path}`,
      ),
    )
    if (
      unavailable.size !== observation.unavailableValues.length ||
      [...values.keys(), ...unavailable.keys()].some(
        (path) => !declared.has(path),
      ) ||
      values.size + unavailable.size !== declared.size
    )
      throw new Error(
        'Configured captured facts differ from declared inspections.',
      )
    for (const inspection of stop.inspections) {
      const path = `${inspection.mode}:${inspection.path}`
      if (values.has(path) === unavailable.has(path))
        throw new Error(
          'Configured inspection must have one captured or unavailable result.',
        )
      if (
        inspection.mode === 'type' &&
        values.has(path) &&
        !REPOSITORY_CAPTURED_TYPES.some((type) => type === values.get(path))
      )
        throw new Error(
          'Configured type inspection is not a captured type string.',
        )
      // Partial source/value evidence remains readable, but it cannot qualify continuation or completed execution.
      if (
        inspection.required &&
        unavailable.has(path) &&
        (study.finalOutcome === 'demonstrated' ||
          study.operation?.afterVerified ||
          continuedIndex >= index)
      )
        throw new Error(
          'Configured completed or continued observation lacks a required fact.',
        )
    }
    for (const interpretation of observation.interpretations) {
      if (
        new Set(interpretation.facts.map((fact) => fact.path)).size !==
          interpretation.facts.length ||
        interpretation.facts.some(
          (fact) =>
            !values.has(fact.path) ||
            JSON.stringify(values.get(fact.path)) !==
              JSON.stringify(fact.value),
        )
      )
        throw new Error(
          'Configured interpretation facts differ from its observation.',
        )
    }
  }
  // Reloaded learning material cannot introduce links to a foreign run or changed captured source.
  if (study.learningSummary) {
    if (
      !study.observations.some((observation) =>
        observation.interpretations.some(
          (value) =>
            value.id === study.learningSummary!.explanationId &&
            value.createdAt === study.learningSummary!.createdAt,
        ),
      )
    )
      throw new Error('Learning summary has no committed explanation.')
    for (const step of study.learningSummary.content.steps) {
      const reference = step.reference
      if (!reference) continue
      if ('snapshotUri' in reference) {
        if (
          !study.observations.some(
            (observation) =>
              observation.snapshotUri === reference.snapshotUri &&
              observation.source.hash === reference.sourceHash,
          )
        )
          throw new Error('Learning summary source reference changed.')
        continue
      }
      if (
        step.evidence !== 'observed' ||
        reference.configurationHash !== study.configurationHash ||
        study.finalOutcome !== 'demonstrated' ||
        !study.operation?.afterVerified ||
        !study.operation.inputAcknowledged
      )
        throw new Error(
          'Learning summary result lacks verified terminal evidence.',
        )
    }
  }
  const operation = study.operation,
    observation = study.observations.find(
      (value) =>
        JSON.stringify(value.pause) ===
        JSON.stringify(study.operation?.continuedPause),
    )
  if (operation?.inputAcknowledged && !operation.inputDispatched)
    throw new Error('Configured input acknowledgement precedes dispatch.')
  if (
    operation?.continuedPause &&
    (!observation ||
      JSON.stringify(operation.continuedPause) !==
        JSON.stringify(observation.pause))
  )
    throw new Error('Configured continuation differs from the captured pause.')
  if (
    operation?.afterVerified &&
    (!operation.inputAcknowledged ||
      !operation.continuedPause ||
      study.observations.length !== stops.length ||
      observation !== study.observations.at(-1))
  )
    throw new Error(
      'Configured after verification lacks confirmed input and continuation.',
    )
  if (
    study.finalOutcome === 'demonstrated' &&
    (!study.terminal ||
      !operation?.afterVerified ||
      study.observations.length !== stops.length)
  )
    throw new Error('Configured completed study is missing required evidence.')
}

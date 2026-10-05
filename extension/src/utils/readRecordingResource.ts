import { RECORDING_FRAME_PAGE_SIZE } from '../constants'
import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import type { RecordingContext } from '../recordingSchemas'
import type { ResourceContent } from '../resources'
import type { StudyService } from '../service'

import { declaredStopOfSnapshot } from './declaredStopOfSnapshot'
import { describeBoundPlace, type BoundPlace } from './describeBoundPlace'
import { explanationPlace, type ExplanationPlace } from './explanationPlace'
import { readJsonPage } from './readJsonPage'

/** A saved study as a recording context retains it. */
type SavedStudy = RecordingContext['study']

/** One observation of a saved study. */
type SavedObservation = SavedStudy['observations'][number]

/**
 * Puts a saved observation's declared, requested and bound places together; called by {@link savedObservationResource}.
 * Saved observations follow the declared stop order, so an observation's index names the stop it answers.
 * @param study - The saved study, with all of its observations in commit order.
 * @param observation - The observation.
 * @returns The places of {@link describeBoundPlace}, with the requested line when the saved receipt keeps one, or `undefined` when no stop is declared for the observation.
 * @example
 * savedBoundPlace(context.study, context.study.observations[0])?.isMoved // => true for a stop declared on line 22 that paused on line 23
 */
function savedBoundPlace(
  study: SavedStudy,
  observation: SavedObservation,
): BoundPlace | undefined {
  // Saved observations follow the declared stop order, so an observation's index names the stop it answers.
  const declared = declaredStopOfSnapshot(
      study.configuration,
      study.observations,
      observation.id,
    ),
    requestedLine = observation.source.binding?.requestedLine
  return (
    declared &&
    describeBoundPlace({
      declared,
      bound: observation.source,
      // The saved receipt keeps the requested line only, and only when it differs from the declared line.
      ...(requestedLine !== undefined && {
        armed: { line: requestedLine },
      }),
    })
  )
}

/**
 * Reads the declared position out of a stop's places; called by {@link savedObservationResource} for `requestedSource` and `declaredSource`.
 * @param boundPlace - The places of the observation's stop, if a stop is declared for it.
 * @returns The declared line and column, or `undefined` without a declared stop.
 * @example
 * declaredPlaceOf(boundPlace) // => { line: 22, column: 3 }
 */
function declaredPlaceOf(
  boundPlace: BoundPlace | undefined,
): { line: number; column: number } | undefined {
  return (
    boundPlace && {
      line: boundPlace.declaredLine,
      column: boundPlace.declaredColumn,
    }
  )
}

/**
 * Puts Codebook's own place of a moved stop beside each of its explanations, whatever their text says; called by {@link savedObservationResource}.
 * @param interpretations - The observation's saved explanations.
 * @param movedPlace - The place of a stop the debugger bound on another line than declared, or `undefined` for a stop that paused where it was declared.
 * @returns The explanations, each with `boundPlace` for a moved stop; the same list otherwise.
 * @example
 * interpretationsBesidePlace(observation.interpretations, undefined) === observation.interpretations // => true
 */
function interpretationsBesidePlace(
  interpretations: SavedObservation['interpretations'],
  movedPlace: ExplanationPlace | undefined,
): Array<
  SavedObservation['interpretations'][number] & {
    boundPlace?: ExplanationPlace
  }
> {
  return movedPlace
    ? interpretations.map((interpretation) => ({
        ...interpretation,
        boundPlace: movedPlace,
      }))
    : interpretations
}

/**
 * Builds what the learning resource of a saved recording says about one observation; called by {@link readRecordingResource} for every observation of the saved study.
 * @param study - The saved study, with all of its observations in commit order.
 * @param observation - The observation.
 * @returns The observation's id, time, bound source, declared source (also under its earlier name `requestedSource`), values and explanations; `place` and `armed` only for a stop whose places differ.
 * @example
 * savedObservationResource(context.study, context.study.observations[0]).source // => { hash: 'a1b2…', line: 23, column: 5 }
 */
function savedObservationResource(
  study: SavedStudy,
  observation: SavedObservation,
) {
  const boundPlace = savedBoundPlace(study, observation),
    declaredPlace = declaredPlaceOf(boundPlace),
    // Codebook's own place of a moved stop stands beside each of its explanations, whatever their text says.
    movedPlace = explanationPlace(boundPlace)
  return {
    id: observation.id,
    elapsedMs: observation.elapsedMs,
    // Only for a stop the debugger bound on another line than declared: the sentence that names the paused line.
    place: boundPlace?.place,
    // The position the debugger bound and paused at, as the live inspection resource reports it; cite this one.
    source: {
      hash: observation.source.hash,
      line: observation.source.line,
      column: observation.source.column,
    },
    // requestedSource keeps its meaning (the declared position); declaredSource says it under its own name.
    requestedSource: declaredPlace,
    declaredSource: declaredPlace,
    armed: boundPlace?.armed,
    values: observation.values,
    unavailableValues:
      'unavailableValues' in observation
        ? observation.unavailableValues
        : undefined,
    interpretations: interpretationsBesidePlace(
      observation.interpretations,
      movedPlace,
    ),
  }
}

/** Resolves only current-instance canonical library/recording resources, using bounded pages and pinned context hashes. @example await readRecordingResource(service, recordingUri) */
export async function readRecordingResource(
  service: StudyService,
  uri: string,
): Promise<ResourceContent> {
  const url = new URL(uri),
    store = service.recordings
  if (url.hostname !== service.instanceId)
    throw new StudyError(
      'STALE_INSTANCE',
      'Recording discovery belongs to a different server instance.',
    )
  if (
    url.toString() !== uri ||
    url.protocol !== 'codebook:' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new StudyError(
      'INVALID_REFERENCE',
      'Use a returned canonical recording URI.',
    )
  if (!store)
    throw new StudyError(
      'EVIDENCE_UNAVAILABLE',
      'Recording storage is unavailable in this workspace.',
    )
  const json = (value: unknown): ResourceContent => ({
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(value),
  })
  const recordingUri = (studyId: string) =>
    `codebook://${service.instanceId}/studies/${studyId}/recording`
  if (url.pathname === '/library') {
    const [studies, recordings] = await Promise.all([
      new LearningLibrary(store.learningDirectory, store.workspaceKey).list(),
      store.list(),
    ])
    const entries = new Map(
      studies.map((study) => [
        study.id,
        {
          studyId: study.id,
          study,
          recording: recordings.find((value) => value.studyId === study.id),
          recordingUri: recordingUri(study.id),
        },
      ]),
    )
    return json({
      instanceId: service.instanceId,
      workspaceKey: store.workspaceKey,
      verification:
        'Catalog metadata only; read a recording to verify its journal and frame hashes.',
      entries: [
        ...entries.values(),
        ...recordings
          .filter((recording) => !entries.has(recording.studyId))
          .map((recording) => ({
            studyId: recording.studyId,
            recording,
            recordingUri: recordingUri(recording.studyId),
          })),
      ],
      playbackUri: `codebook://${service.instanceId}/playback`,
    })
  }
  if (url.pathname === '/playback')
    return json({
      instanceId: service.instanceId,
      ...service.playbackController?.state(),
      available: Boolean(service.playbackController),
      uri,
      libraryUri: `codebook://${service.instanceId}/library`,
    })
  const match =
    /^\/studies\/([a-f0-9-]{36}_[a-f0-9-]{36})\/recording(?:\/(frames\/(?:0|[1-9]\d*)|frame\/[a-f0-9]{64}|context\/[a-f0-9]{64}(?:\/learning(?:\/pages\/[a-f0-9]{64}\/(?:0|[1-9]\d*))?)?))?$/.exec(
      url.pathname,
    )
  if (!match?.[1])
    throw new StudyError(
      'INVALID_REFERENCE',
      'Unknown recording resource; copy a returned canonical URI.',
    )
  const studyId = match[1],
    suffix = match[2],
    base = recordingUri(studyId)
  try {
    if (suffix?.startsWith('context/')) {
      const [, contextHash, selection, ...page] = suffix.split('/')
      const { context } = await store.readContext(studyId, contextHash)
      if (!selection) return json(context)
      return readJsonPage(
        `${base}/context/${contextHash}/learning`,
        {
          studyId,
          contextHash,
          historyRevision: context.historyRevision,
          studyHash: context.studyHash,
          materialSignature: context.materialSignature,
          historical: true,
          learningSummary:
            'learningSummary' in context.study
              ? context.study.learningSummary
              : undefined,
          observations: context.study.observations.map((observation) =>
            savedObservationResource(context.study, observation),
          ),
          interpretationAvailability: context.interpretationAvailability,
          pausedIntervals: context.pausedIntervals,
        },
        page.length ? page.join('/') : undefined,
      )
    }
    const index = await (suffix
      ? store.readResourceIndex(studyId)
      : store.read(studyId))
    if (!suffix) {
      let contextHash: string | undefined, contextReason: string | undefined
      try {
        contextHash = (await store.readContext(studyId)).hash
      } catch (error) {
        contextReason = String(error)
      }
      return json({
        header: index.header,
        status: index.status,
        reason: index.reason,
        endMs: index.endMs,
        lastVerifiedMs: index.lastVerifiedMs,
        frameCount: index.entries.filter((entry) => entry.type === 'frame')
          .length,
        lastSequence: index.entries.at(-1)?.sequence ?? 0,
        framesUri: `${base}/frames/0`,
        contextUri: contextHash ? `${base}/context/${contextHash}` : undefined,
        learningUri: contextHash
          ? `${base}/context/${contextHash}/learning`
          : undefined,
        contextReason,
        playbackUri: `codebook://${service.instanceId}/playback`,
        historical: true,
      })
    }
    if (suffix.startsWith('frames/')) {
      const cursor = Number(suffix.slice('frames/'.length))
      if (!Number.isSafeInteger(cursor))
        throw new StudyError(
          'INVALID_REFERENCE',
          'Frame cursor is outside its integer range.',
        )
      const entries = index.entries
          .filter((entry) => entry.sequence > cursor)
          .slice(0, RECORDING_FRAME_PAGE_SIZE),
        last = entries.at(-1)?.sequence ?? cursor
      return json({
        entries: entries.map((entry) =>
          entry.type === 'frame'
            ? { ...entry, uri: `${base}/frame/${entry.hash}` }
            : entry,
        ),
        afterSequence: cursor,
        lastSequence: last,
        verification:
          'Current sealed journal identity with a pinned verified index; individual PNG bytes are reverified when fetched. Recording metadata and playback Open perform fresh full verification.',
        nextUri: index.entries.some((entry) => entry.sequence > last)
          ? `${base}/frames/${last}`
          : undefined,
        status: index.status,
        endMs: index.endMs,
      })
    }
    const hash = suffix.slice('frame/'.length)
    if (
      !index.entries.some(
        (entry) => entry.type === 'frame' && entry.hash === hash,
      )
    )
      throw new StudyError(
        'INVALID_REFERENCE',
        'This frame does not belong to the recording journal.',
      )
    return {
      uri,
      mimeType: 'image/png',
      blob: (await store.readFrame(studyId, hash)).toString('base64'),
    }
  } catch (error) {
    if (error instanceof StudyError) throw error
    throw new StudyError(
      'EVIDENCE_UNAVAILABLE',
      String(error),
      `Read ${base} or codebook://${service.instanceId}/library for current recording/context references. No execution was started.`,
    )
  }
}

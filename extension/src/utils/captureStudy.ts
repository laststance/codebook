import { configuredObservationSchema } from '../configuredStudySchemas'
import {
  RECORDED_LOCATION_STUDY_VERSION,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
} from '../constants'
import { EvidenceIntegrityError, StudyError } from '../errors'
import { readResource } from '../resources'
import type { RetainedStudy } from '../retainedStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { StudyRecord, StudyService } from '../service'

import { decodeRetainedStudy } from './decodeRetainedStudy'
import { describeStudy } from './describeStudy'
import { redactPreparedConfiguration } from './redactPreparedConfiguration'

/** Copies only committed canonical evidence for {@link StudyWorkspace}; a changed read is discarded. @example await captureStudy(service, record, workspaceKey) */
export async function captureStudy(
  service: StudyService,
  record: StudyRecord,
  workspaceKey: string,
): Promise<RetainedStudy | undefined> {
  // Node source stops are live evidence only until the cross-runtime recording schema can retain them.
  if (record.profile !== REPOSITORY_BROWSER_PROFILE) return undefined
  const state = service.state(record),
    signature = state.materialSignature,
    runtime = record.runtime?.view()
  // Evidence withdrawn after the state snapshot belongs to a newer checkpoint: discard this copy like the final signature check.
  const readCommitted = async (
    uri: string,
  ): Promise<Awaited<ReturnType<typeof readResource>> | undefined> => {
    try {
      return await readResource(service, uri)
    } catch (error) {
      // Altered sealed bytes stay an integrity failure even when the state also changed meanwhile.
      if (
        error instanceof StudyError &&
        !(error instanceof EvidenceIntegrityError) &&
        error.code === 'EVIDENCE_UNAVAILABLE' &&
        service.state(record).materialSignature !== signature
      )
        return undefined
      throw error
    }
  }
  const observations: RetainedStudy['observations'][number][] = []
  const captures: RetainedStudy['captures'][number][] = []
  for (const reference of state.observations) {
    const snapshotUri = reference.snapshotUri
    const snapshot = service.snapshot(record, snapshotUri)
    const source = await readCommitted(`${snapshotUri}/source/typescript`)
    if (source === undefined) return undefined
    if (!('text' in source))
      throw new Error('Captured TypeScript is unavailable.')
    const committed = runtime?.events.find(
      (event) =>
        event.type === 'snapshot.committed' &&
        event.detail &&
        typeof event.detail === 'object' &&
        'snapshotId' in event.detail &&
        event.detail.snapshotId === snapshot.id,
    )
    if (!committed)
      throw new Error('The snapshot has no committed receipt time.')
    const interpretations = [...record.explanations.values()]
      .filter((value) => value.snapshotUri === snapshotUri)
      .map((value) => ({
        id: value.id,
        text: value.agentInterpretation,
        createdAt: value.createdAt,
        facts: value.capturedFacts,
      }))
    // Versioned validators reject mixed evidence before any history or recording writer can accept it.
    if (snapshot.actionId === REPOSITORY_BROWSER_ACTION) {
      if (
        record.profile !== REPOSITORY_BROWSER_PROFILE ||
        source.text !== snapshot.source.text ||
        committed.elapsedMs !== snapshot.elapsedMs ||
        committed.wallTime !== snapshot.capturedAt
      )
        throw new Error(
          'Configured snapshot differs from its committed source/receipt.',
        )
      observations.push(
        configuredObservationSchema.parse({
          ...snapshot,
          snapshotUri,
          interpretations,
        }),
      )
    }
  }
  const descriptor = describeStudy(
    record.profile === REPOSITORY_BROWSER_PROFILE
      ? { ...record, descriptor: record.definition?.descriptor }
      : record,
  )
  for (const phase of record.profile === REPOSITORY_BROWSER_PROFILE &&
  !record.definition
    ? []
    : descriptor.capturePhases) {
    const current = state.captures.find((value) => value.phase === phase)
    // New runtimes retain every committed pause; a pending next stop cannot overwrite its predecessor.
    const references =
      phase.startsWith('paused-') && runtime?.snapshotCaptures !== undefined
        ? runtime.snapshots.length
          ? runtime.snapshots
              .filter((snapshot) => snapshot.capturePhase === phase)
              .map((snapshot) => ({
                phase,
                snapshotId: snapshot.id,
                ...runtime.snapshotCaptures![snapshot.id]!,
                uri: service.uri(
                  record.id,
                  `snapshots/${encodeURIComponent(snapshot.id)}/image`,
                ),
              }))
          : [
              {
                phase,
                snapshotId: undefined,
                status: current ? 'pending' : 'absent',
                error: current?.error,
                uri: undefined,
              },
            ]
        : [
            {
              phase,
              snapshotId: undefined,
              status: current?.status ?? 'absent',
              error: current?.error,
              uri: current?.uri,
            },
          ]
    for (const capture of references) {
      const identity = capture.snapshotId
        ? { phase, snapshotId: capture.snapshotId }
        : { phase }
      if (capture.status === 'captured') {
        if (!capture.uri)
          throw new Error('Confirmed image has no canonical resource.')
        const image = await readCommitted(capture.uri)
        if (image === undefined) return undefined
        if (!('blob' in image))
          throw new Error('Captured image is unavailable.')
        captures.push({
          ...identity,
          status: 'captured',
          base64: image.blob,
          hash: sha256(Buffer.from(image.blob, 'base64')),
        })
      } else
        captures.push({
          ...identity,
          status:
            capture.status === 'failed'
              ? 'failed'
              : capture.status === 'pending'
                ? 'pending'
                : 'absent',
          reason:
            capture.error ??
            (capture.status === 'pending'
              ? 'Capturing this observation…'
              : 'No confirmed image for this phase.'),
        })
    }
  }
  // Never combine a completed control state with evidence gathered across a different transition.
  if (service.state(record).materialSignature !== signature) return undefined
  const summaryExplanation = [...record.explanations.values()]
    .filter((value) => value.learningSummary)
    .at(-1)
  const learningSummary = summaryExplanation?.learningSummary && {
    content: summaryExplanation.learningSummary,
    explanationId: summaryExplanation.id,
    createdAt: summaryExplanation.createdAt,
  }
  // The saved study carries the canonical redacted configuration (secret and unresolved prepared texts masked), never the declared texts.
  const canonicalConfiguration = redactPreparedConfiguration(
    record.configuration,
    runtime?.preparedTextStates ?? [],
    'canonical',
  )
  const configured =
    record.profile === REPOSITORY_BROWSER_PROFILE
      ? {
          version: RECORDED_LOCATION_STUDY_VERSION,
          configuration: canonicalConfiguration,
          configurationHash: sha256(JSON.stringify(canonicalConfiguration)),
          descriptor: record.definition?.descriptor,
          // A Vite study names the Vite it ran on; a Next study carries no such field.
          ...(runtime?.profile === REPOSITORY_BROWSER_PROFILE &&
          runtime.viteVersion
            ? { viteVersion: runtime.viteVersion }
            : {}),
          operation:
            runtime?.profile === REPOSITORY_BROWSER_PROFILE
              ? runtime.operation
              : undefined,
        }
      : {}
  return decodeRetainedStudy(
    {
      ...configured,
      workspaceKey,
      id: `${service.instanceId}_${record.id}`,
      instanceId: service.instanceId,
      runId: record.id,
      profile: record.profile,
      createdAt: state.createdAt,
      savedAt: new Date().toISOString(),
      state: state.state,
      terminal: record.stopped || state.resourcesReleased,
      finalOutcome: state.finalOutcome,
      materialSignature: signature,
      reason: state.terminalReason ?? state.cleanupError?.message,
      learningSummary,
      observations,
      captures,
      links: [],
    },
    workspaceKey,
  )
}

import { configuredObservationSchema } from '../configuredStudySchemas'
import {
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  NEXT_LIBRARY_STUDY_VERSION,
  REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
  VITE_LIBRARY_STUDY_VERSION,
} from '../constants'
import { EvidenceIntegrityError, StudyError } from '../errors'
import type { LibraryRunFacts } from '../libraryRunFactsSchema'
import { readResource } from '../resources'
import type { RetainedStudy } from '../retainedStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { StudyRecord, StudyService } from '../service'

import { withCanonicalPackageRoot } from './canonicalDefinition'
import { decodeRetainedStudy } from './decodeRetainedStudy'
import { describeStudy } from './describeStudy'
import { maskLearningSummaryText } from './maskLearningSummaryText'
import { observationOfFormat } from './observationOfFormat'
import { projectSavedOperations } from './projectSavedOperations'
import { redactPreparedConfiguration } from './redactPreparedConfiguration'
import {
  studyFormatOfEvidence,
  studyRulesVersionOf,
  usesServerRenderEvidence,
} from './studyFormatOfConfiguration'

/**
 * The facts of a declared library that no run ever prepared: `package` holds the declared folder until a name is known.
 * Called by {@link captureStudy} when a format 16, 17 or 18 study is saved without runtime library facts.
 * @param configuration - The sealed configuration of the study.
 * @returns The pending facts, or `undefined` when the configuration declares no library.
 * @example pendingLibraryFacts(configuration) // => { package: 'packages/widgets', packageRoot: 'packages/widgets', prepared: false, observation: 'pending' }
 */
function pendingLibraryFacts(
  configuration: unknown,
): LibraryRunFacts | undefined {
  const packageRoot = (
    configuration as { library?: { packageRoot?: string } } | undefined
  )?.library?.packageRoot
  if (packageRoot === undefined) return undefined
  return {
    package: packageRoot,
    packageRoot,
    prepared: false,
    observation: 'pending',
  }
}

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
        // The chat's words and the facts it quoted are masked by the learner's secrets (ENG-4).
        text: service.maskLearnerSecretsInText(value.agentInterpretation),
        createdAt: value.createdAt,
        facts: service.maskLearnerSecretsInData(value.capturedFacts),
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
      // The format 8 pause fields are kept or dropped once, by observationOfFormat, when the study is assembled below.
      // `preparationRequest` is a live field of the run resource; it is never saved, so the strict observation schema never sees it.
      const { preparationRequest: _preparationRequest, ...saved } = snapshot
      observations.push(
        configuredObservationSchema.parse({
          ...saved,
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
        // A withheld image, and a preparation pause before any page could be drawn, are saved as absent images with the runtime's reason sentence, so the saved format and older readers stay unchanged.
        captures.push({
          ...identity,
          status:
            capture.status === 'failed'
              ? 'failed'
              : capture.status === 'pending'
                ? 'pending'
                : 'absent',
          reason: service.maskLearnerSecretsInText(
            capture.error ??
              (capture.status === 'pending'
                ? 'Capturing this observation…'
                : 'No confirmed image for this phase.'),
          ),
        })
    }
  }
  // Never combine a completed control state with evidence gathered across a different transition.
  if (service.state(record).materialSignature !== signature) return undefined
  const summaryExplanation = [...record.explanations.values()]
    .filter((value) => value.learningSummary)
    .at(-1)
  const learningSummary = summaryExplanation?.learningSummary && {
    // Only the free-text fields are masked; ids, references, evidence and from/to are structure the study checks again.
    content: maskLearningSummaryText(
      summaryExplanation.learningSummary,
      (text) => service.maskLearnerSecretsInText(text),
    ),
    explanationId: summaryExplanation.id,
    createdAt: summaryExplanation.createdAt,
  }
  // The saved study carries the canonical redacted configuration (secret and unresolved prepared texts masked), never the declared texts.
  // The states are frozen at the first capture: a text still unresolved then stays masked in every later checkpoint, so the saved configuration and its hash never change (ENG-3).
  record.canonicalTextStates ??= [...(runtime?.preparedTextStates ?? [])]
  const redactedConfiguration = redactPreparedConfiguration(
    record.configuration,
    record.canonicalTextStates,
    'canonical',
  )
  // E10: a nested run saves the canonical repository-relative real path of its folder (a symlinked alias saves its target); the declared value stays in the run's evidence journal.
  // A declared alias that resolved to the repository root (runtime value ".") is a root run: its saved configuration drops the field and keeps the root run's format.
  const canonicalConfiguration = withCanonicalPackageRoot(
    redactedConfiguration,
    runtime?.nextPackageRoot,
  )
  // Fixed by the sealed configuration, except that a Next study takes format 12 from its first module-evaluation or preparation observation on; the runtime's format 8 pause fields are written only in format 8 rules.
  const studyVersion = studyFormatOfEvidence(
    canonicalConfiguration,
    observations,
  )
  // Format 21 (a press) keeps the library facts of the format its configuration takes without the press.
  const rulesVersion = studyRulesVersionOf({
    version: studyVersion,
    configuration: canonicalConfiguration,
  })
  const configured =
    record.profile === REPOSITORY_BROWSER_PROFILE
      ? {
          // A study of ordered operations has its own format, so an older Codebook lists it as saved by a newer one instead of failing on its schema.
          // The format follows the sealed configuration, except that a Next study moves once from format 8 or 9 to 12 at its first module-evaluation or preparation observation (assertStudyCheckpoint allows only that move).
          version: studyVersion,
          configuration: canonicalConfiguration,
          configurationHash: sha256(JSON.stringify(canonicalConfiguration)),
          descriptor: record.definition?.descriptor,
          // A Vite study names the Vite it ran on; a Next study carries no such field.
          ...(runtime?.profile === REPOSITORY_BROWSER_PROFILE &&
          runtime.viteVersion
            ? { viteVersion: runtime.viteVersion }
            : {}),
          // An Expo study names the Expo SDK it ran on (format 15); no other study carries the field.
          ...(runtime?.profile === REPOSITORY_BROWSER_PROFILE &&
          runtime.expoVersion
            ? { expoVersion: runtime.expoVersion }
            : {}),
          // A Vite, react-scripts or Next library study (format 16, 17 or 18) keeps the library facts as they stand at this checkpoint; no other study carries them.
          // A run that ended before the library route existed (a refusal in package resolution, admission, source preparation or workspace checks) has no facts yet: it saves the pending facts of the declared folder, so the preparation failure stays representable.
          ...(rulesVersion === VITE_LIBRARY_STUDY_VERSION ||
          rulesVersion === REACT_SCRIPTS_LIBRARY_STUDY_VERSION ||
          rulesVersion === NEXT_LIBRARY_STUDY_VERSION
            ? {
                library:
                  (runtime?.profile === REPOSITORY_BROWSER_PROFILE
                    ? runtime.library
                    : undefined) ?? pendingLibraryFacts(canonicalConfiguration),
              }
            : {}),
          // A format 8 study says the first execution of the page was not observed.
          ...(usesServerRenderEvidence({
            version: studyVersion,
            configuration: canonicalConfiguration,
          }) && runtime?.firstExecutionObserved === false
            ? { firstExecutionObserved: false as const }
            : {}),
          operation:
            runtime?.profile === REPOSITORY_BROWSER_PROFILE
              ? runtime.operation
              : undefined,
          // Every declared operation with the state it reached, as the run resource lists it when this checkpoint is taken; a run that declares none (entry render only) saves no list.
          ...(runtime?.operations?.length
            ? {
                operations: projectSavedOperations(
                  runtime.operations,
                  runtime.events,
                ),
              }
            : {}),
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
      reason:
        service.maskLearnerSecretsInText(
          state.terminalReason ?? state.cleanupError?.message ?? '',
        ) || undefined,
      learningSummary,
      observations: observations.map((observation) =>
        observationOfFormat(observation, {
          version: studyVersion,
          configuration: canonicalConfiguration,
        }),
      ),
      captures,
      links: [],
    },
    workspaceKey,
  )
}

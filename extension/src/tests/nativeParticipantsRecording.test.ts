import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import {
  recordingContextSchema,
  retainedRecordingContextSchema,
} from '../recordingSchemas'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startSchema } from '../schemas'
import { StudyService } from '../service'
import { captureStudy } from '../utils/captureStudy'
import { createRecordingObserver } from '../utils/createRecordingObserver'
import { projectRecording } from '../utils/projectRecording'

import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

for (const scenario of [
  {
    participants: ['server', 'browser', 'server'] as const,
    generations: [1, 1, 2],
    seeks: [2, 0, 1, 2, 0],
  },
  {
    participants: [
      'server',
      'browser',
      'server',
      'server',
      'browser',
      'server',
      'browser',
      'server',
    ] as const,
    generations: [1, 1, 2, 3, 2, 4, 3, 5],
    seeks: [7, 0, 4, 6, 3, 7, 0],
  },
])
  test(`all ${scenario.participants.length} public cross-runtime stops retain explanations, source and native debugger moments through recording restart`, async (context) => {
    // Arrange: production service/coordinator/storage, controlled transports and inert source records only.
    let service: StudyService | undefined,
      books: RepositoryBookStore | undefined
    context.after(async () => {
      await service?.shutdown()
      books?.dispose()
    })
    const harness = await nativeParticipantsHarness(
        context,
        scenario.participants,
      ),
      directory = join(harness.directory, '.learning')
    const library = new LearningLibrary(directory, '0'.repeat(64)),
      store = new RecordingStore(directory, library.workspaceKey)
    books = new RepositoryBookStore(harness.sources, library)
    await books.publish({
      bookId: 'interface',
      expectedRevision: 0,
      key: 'article',
      document: {
        title: 'Interface',
        summary: 'Two source citations.',
        nodes: [
          {
            id: 'theme',
            title: 'Theme',
            sections: [{ title: 'Path', text: 'Source-derived explanation.' }],
            anchors: harness.definition.descriptor.anchors,
            observations: [],
          },
        ],
        edges: [],
      },
    })
    service = new StudyService(
      {
        workspace: harness.directory,
        host: {
          id: 'vscode',
          productVersion: 'test',
          apiVersion: 'test',
          commit: 'test',
        },
        build: {
          revision: 'controlled-transports',
          dirty: false,
          sourceHash: '0'.repeat(64),
        },
        prerequisites: async () => ({ ready: true, missing: [] }),
        createRuntime: async (_directory, definition) => {
          assert.deepEqual(
            definition.configuration,
            harness.definition.configuration,
          )
          return harness.run
        },
      },
      join(harness.directory, '.service'),
    )
    service.repository = books
    service.recordings = store
    const input = startSchema.parse({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'ordered',
      configuration: harness.definition.configuration,
    })
    const receipt = service.start(input),
      record = service.record(receipt)
    harness.observeRecording(() => createRecordingObserver(record))
    await record.preparation
    assert.equal(record.error, undefined)
    assert.deepEqual(service.start(input), receipt)

    // Act: consume public current continuation arguments and checkpoint each explanation before continuing.
    service.action({ ...receipt, key: 'one-input', action: 'repository-click' })
    const expectedParticipants = scenario.participants
    for (const [index, participant] of expectedParticipants.entries()) {
      const snapshot = await waitUntil(
        () =>
          harness.run.view().snapshots[index] &&
          harness.run.view().participants[participant]?.snapshot,
        `committed ${participant} pause ${index}`,
      )
      const state: ReturnType<StudyService['state']> = service.state(record)
      const current = state.participants[participant]
      assert.ok(current?.continueArguments && current.snapshotUri)
      assert.equal(current.continueArguments.participant, participant)
      assert.equal(
        state.participants[participant === 'server' ? 'browser' : 'server']
          ?.resumable,
        false,
      )
      const observation = state.observations[index]!
      const source = await readResource(service, observation.sourceUri)
      assert.ok('text' in source)
      assert.equal(
        source.text,
        participant === 'server'
          ? 'export const mode = "display";\n'
          : 'const nextTheme = "dark";\n',
      )
      const phaseImage = state.captures.find(
        (capture) => capture.phase === `paused-${participant}`,
      )?.uri
      assert.ok(phaseImage && observation.imageUri)
      const image = await readResource(service, observation.imageUri),
        latestImage = await readResource(service, phaseImage)
      assert.ok('blob' in image && 'blob' in latestImage)
      assert.equal(image.blob, latestImage.blob)
      await service.explain({
        ...receipt,
        key: `explanation-${index}`,
        snapshotUri: current.snapshotUri,
        sourceHash: snapshot.source.hash,
        valuePaths: [
          participant === 'server' ? 'value:mode' : 'value:nextTheme',
        ],
        interpretation: `The ${participant} value was captured at declared stop ${index + 1}.`,
        learningSummary:
          index === expectedParticipants.length - 1
            ? {
                question: 'Explain the observed path.',
                title: 'Ordered execution',
                summary:
                  'Independently verified stops; causal relationships remain unknown.',
                participants: [
                  { id: 'browser', label: 'Browser' },
                  { id: 'server', label: 'Server' },
                ],
                steps: state.observations.map((observed, position) => ({
                  id: `stop-${position}`,
                  from: observed.participant,
                  to: observed.participant,
                  label: `Stop ${position + 1}`,
                  explanation: 'This source position was observed.',
                  evidence: 'observed',
                  reference: {
                    snapshotUri: observed.snapshotUri,
                    sourceHash:
                      harness.run.view().snapshots[position]!.source.hash,
                  },
                })),
              }
            : undefined,
      })
      const checkpoint = await captureStudy(
        service,
        record,
        library.workspaceKey,
      )
      assert.ok(checkpoint)
      const revision = service.beginHistory(
        record,
        checkpoint.materialSignature,
      )
      assert.ok(revision)
      await library.saveStudy(checkpoint)
      service.reportHistory(
        record,
        checkpoint.materialSignature,
        revision,
        'saved',
      )
      await service.saveRecordingContext(record, checkpoint, revision)
      assert.equal(record.recordingReceipt?.status, 'saved')
      await service.continue(current.continueArguments)
    }
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'after conditions',
    )
    await service.stop(receipt)
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    const revision = service.beginHistory(record, archive.materialSignature)
    assert.ok(revision)
    await library.saveStudy(archive)
    service.reportHistory(record, archive.materialSignature, revision, 'saved')
    await service.saveRecordingContext(record, archive, revision)
    const restarted = new RecordingStore(directory, library.workspaceKey),
      saved = await restarted.readContext(archive.id),
      recording = await restarted.read(archive.id)

    // Assert: a restarted reader recovers each participant's own source/values, including repeated server generation.
    assert.equal(archive.version, 4)
    assert.equal(recording.header?.version, 3)
    assert.equal(
      service.state(record).recordedStudyOutcome,
      'demonstrated',
      JSON.stringify({
        recording: service.state(record).recording,
        history: service.state(record).historyOutcome,
        finalOutcome: archive.finalOutcome,
      }),
    )
    assert.deepEqual(
      archive.observations.map((observation) => [
        observation.participant,
        observation.pause.generation,
        observation.interpretations.length,
      ]),
      scenario.participants.map((participant, index) => [
        participant,
        scenario.generations[index],
        1,
      ]),
    )
    assert.deepEqual(
      recording.entries
        .filter((entry) => entry.type === 'frame')
        .map((entry) => entry.phase),
      [
        'before',
        ...scenario.participants.map((participant) => `paused-${participant}`),
        'after',
      ],
    )
    for (const index of scenario.seeks) {
      const observation: (typeof archive.observations)[number] =
        archive.observations[index]!
      const projection = projectRecording(
        recording,
        saved.context,
        observation.elapsedMs,
      )
      assert.ok(projection.observation)
      assert.equal(projection.observation?.id, observation.id)
      assert.equal(projection.observation.source.text, observation.source.text)
      assert.equal(projection.pauseConfirmed, true)
      assert.equal(projection.rendererConfirmed, true)
      assert.equal(
        projection.debugger?.frames[0]?.name,
        scenario.participants[index] === 'browser'
          ? 'browserStep'
          : 'serverStep',
      )
      assert.equal(
        projection.debugger?.variables[0]?.value,
        scenario.participants[index] === 'browser' ? 'dark' : 'display',
      )
      // Cycle 0045 (cause 10): the explanation saved while this pause was held is the stop's explanation at its own recorded time.
      assert.deepEqual(
        projection.observation.interpretations.map(
          (interpretation) => interpretation.text,
        ),
        [
          `The ${observation.participant} value was captured at declared stop ${index + 1}.`,
        ],
      )
      assert.equal(projection.laterInterpretations.length, 0)
    }
    assert.equal(
      projectRecording(recording, saved.context, recording.endMs!).debugger,
      undefined,
    )
    assert.equal(
      harness.commands.filter(
        (command) => command.method === 'Input.dispatchMouseEvent',
      ).length,
      2,
    )
    assert.equal(
      harness.commands.some(
        (command) =>
          command.participant === 'server' &&
          command.method.startsWith('Input.'),
      ),
      false,
    )
    assert.deepEqual(
      saved.context.study.observations.map(
        (observation) => observation.interpretations.length,
      ),
      scenario.participants.map(() => 1),
    )
    assert.equal(
      saved.context.pausedIntervals?.length,
      scenario.participants.length,
    )
    if (scenario.participants.length === 8) {
      assert.equal(
        retainedRecordingContextSchema.safeParse({
          ...saved.context,
          pausedIntervals: [
            ...saved.context.pausedIntervals,
            saved.context.pausedIntervals[0],
          ],
        }).success,
        false,
      )
      assert.equal(
        recordingContextSchema.shape.pausedIntervals.safeParse(
          saved.context.pausedIntervals,
        ).success,
        false,
      )
    }
    assert.deepEqual(
      saved.context.study.learningSummary?.content.steps.map((step) =>
        step.reference && 'sourceHash' in step.reference
          ? step.reference.sourceHash
          : undefined,
      ),
      archive.observations.map((observation) => observation.source.hash),
    )
    assert.deepEqual(archive.links, [])
  })

test('version 2 with a mismatched citation fails before runtime acquisition and retains a readable failed history', async (context) => {
  // Arrange
  const { service, configuration, runtimes, library } =
    await configuredServiceHarness(context)
  const input = startSchema.parse({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'wrong-citation',
    configuration: {
      ...configuration,
      version: 2,
      participant: 'server',
      book: { ...configuration.book, anchorIndex: 1 },
    },
  })
  // Act
  const receipt = service.start(input),
    record = service.record(receipt)
  await record.preparation
  await service.stop(receipt)
  const archive = await captureStudy(service, record, library.workspaceKey)
  assert.ok(archive)
  // Assert
  assert.equal(record.error?.code, 'INVALID_CONFIGURATION')
  assert.equal(runtimes.length, 0)
  assert.equal(archive.version, 4)
  assert.equal(archive.finalOutcome, 'not-demonstrated')
  assert.deepEqual(archive.observations, [])
  await library.saveStudy(archive)
})

test('public configuration rejects mixed version shapes and unknown participants before reserving execution', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const input = {
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'invalid',
  }
  // Act / Assert
  for (const candidate of [
    { ...configuration, version: 2 },
    { ...configuration, participant: 'server' },
    { ...configuration, version: 2, participant: 'worker' },
    {
      ...configuration,
      version: 2,
      participant: 'server',
      additionalStops: [
        { line: 1, column: 1, inspections: configuration.inspections },
      ],
    },
  ])
    assert.equal(
      startSchema.safeParse({ ...input, configuration: candidate }).success,
      false,
    )
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

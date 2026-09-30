import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { learningSummarySchema } from '../learningSummarySchemas'
import { LearningLibrary } from '../learningLibrary'
import { validateRecordingContext } from '../utils/validateRecordingContext'
import { presentationReadingPoseSchema } from '../presentationSchemas'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { captureStudy } from '../utils/captureStudy'
import { decodeRetainedStudy } from '../utils/decodeRetainedStudy'
import { projectLearningSummary } from '../utils/projectLearningSummary'
import { snapshotSourceHashes } from '../utils/snapshotSourceHashes'
import { readResource } from '../resources'
import { ControlledRuntime, createHarness } from './helpers'
import type { ConfiguredRuntimeView } from '../runtime'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

/** Supplies bounded authoring input for storage/reference tests without running a demonstration application. @example summaryFor(snapshotUri, sourceHash).steps[0]?.id // 'select' */
function summaryFor(snapshotUri: string, sourceHash: string) {
  return learningSummarySchema.parse({
    question: 'How does the selected theme reach the interface?',
    title: 'Theme selection',
    summary:
      'The recorded stop holds the selected dark theme. Later rendering was not recorded.',
    participants: [
      { id: 'control', label: 'Theme control' },
      { id: 'interface', label: 'Interface' },
    ],
    steps: [
      {
        id: 'select',
        from: 'control',
        to: 'interface',
        label: 'Selected theme',
        explanation: 'The stop records nextTheme as dark.',
        evidence: 'observed',
        reference: { snapshotUri, sourceHash },
      },
      {
        id: 'later',
        from: 'interface',
        to: 'interface',
        label: 'Later rendering',
        explanation: 'No later stop was captured.',
        evidence: 'unknown',
      },
    ],
  })
}

for (const mutation of [
  'duplicate participant',
  'duplicate step',
  'undeclared participant',
  'unanchored observation',
  'unanchored source interpretation',
])
  test(`learning authoring rejects ${mutation}`, () => {
    // Arrange
    const content = summaryFor('codebook://snapshot', 'a'.repeat(64))
    // Act
    if (mutation === 'duplicate participant')
      content.participants.push(content.participants[0]!)
    if (mutation === 'duplicate step') content.steps.push(content.steps[0]!)
    if (mutation === 'undeclared participant') content.steps[0]!.from = 'absent'
    if (mutation === 'unanchored observation')
      delete content.steps[0]!.reference
    if (mutation === 'unanchored source interpretation') {
      content.steps[1]!.evidence = 'source-derived'
    }
    // Assert
    assert.equal(learningSummarySchema.safeParse(content).success, false)
  })

test('old recordings keep an explicit absent summary while saved learning survives archive and recording-context decoding', () => {
  // Arrange
  const study = createConfiguredStudy(),
    observation = study.observations[0]!,
    interpretation = observation.interpretations[0]!
  assert.equal(
    projectLearningSummary(decodeRetainedStudy(study, study.workspaceKey)),
    undefined,
  )
  study.learningSummary = {
    content: summaryFor(observation.snapshotUri, observation.source.hash),
    explanationId: interpretation.id,
    createdAt: interpretation.createdAt,
  }
  // Act
  const archive = decodeRetainedStudy(
    JSON.parse(JSON.stringify(study)),
    study.workspaceKey,
  )
  const context = validateRecordingContext(
    JSON.parse(JSON.stringify(buildRecordingContext(archive, [], 1))),
    study.workspaceKey,
  )
  // Assert
  assert.deepEqual(archive.learningSummary, study.learningSummary)
  assert.deepEqual(context.study.learningSummary, study.learningSummary)
  assert.deepEqual(projectLearningSummary(context.study)?.positions, [
    { stepId: 'select', elapsedMs: 2000 },
  ])
  assert.equal(context.interpretationAvailability[0]?.elapsedMs, null)
})

test('a verified form result can become an observed sequence step without citing the earlier pause as result evidence', () => {
  // Arrange
  const study = createConfiguredStudy()
  const afterCapture = study.captures.find(
    (capture) => capture.phase === 'after',
  )
  if (!afterCapture || afterCapture.status !== 'captured')
    throw new Error('Expected a sealed result frame.')
  const content = summaryFor(
    study.observations[0]!.snapshotUri,
    study.observations[0]!.source.hash,
  )
  // Act
  const parsed = learningSummarySchema.parse({
    ...content,
    steps: [
      content.steps[0],
      {
        id: 'result',
        from: 'interface',
        to: 'interface',
        label: 'Theme changed',
        explanation: 'The after condition and frame verify the dark theme.',
        evidence: 'observed',
        reference: {
          kind: 'terminal',
          configurationHash: study.configurationHash,
          captureHash: afterCapture.hash,
        },
      },
    ],
  })
  // Assert
  assert.equal(parsed.steps[1]?.evidence, 'observed')
  assert.deepEqual(parsed.steps[1]?.reference, {
    kind: 'terminal',
    configurationHash: study.configurationHash,
    captureHash: afterCapture.hash,
  })
})

test('a verified result link survives archive and recording reload and seeks to the recorded after frame', () => {
  // Arrange
  const study = createConfiguredStudy()
  const afterCapture = study.captures.find(
    (capture) => capture.phase === 'after',
  )
  if (!afterCapture || afterCapture.status !== 'captured')
    throw new Error('Expected a sealed result frame.')
  const content = summaryFor(
    study.observations[0]!.snapshotUri,
    study.observations[0]!.source.hash,
  )
  content.steps[1] = {
    id: 'result',
    from: 'interface',
    to: 'interface',
    label: 'Theme changed',
    explanation: 'The after predicate and frame verify dark mode.',
    evidence: 'observed',
    reference: {
      kind: 'terminal',
      configurationHash: study.configurationHash,
      captureHash: afterCapture.hash,
    },
  }
  const interpretation = study.observations[0]!.interpretations[0]!
  study.learningSummary = {
    content,
    explanationId: interpretation.id,
    createdAt: interpretation.createdAt,
  }
  const context = buildRecordingContext(study, [], 1)
  const afterPhase = context.phases.find((phase) => phase.phase === 'after')
  if (!afterPhase) throw new Error('Expected an after recording phase.')
  afterPhase.requestedMs = 3000
  afterPhase.pixelsMs = 4000
  afterPhase.rendererConfirmedMs = 4100
  afterPhase.hash = afterCapture.hash
  // Act
  const archive = decodeRetainedStudy(
    structuredClone(study),
    study.workspaceKey,
  )
  const restored = validateRecordingContext(
    structuredClone(context),
    study.workspaceKey,
  )
  // Assert
  assert.deepEqual(archive.learningSummary, study.learningSummary)
  assert.deepEqual(
    projectLearningSummary(restored.study, restored.phases)?.positions,
    [
      { stepId: 'select', elapsedMs: 2000 },
      { stepId: 'result', elapsedMs: 4100 },
    ],
  )
})

for (const mutation of [
  'unverified result',
  'wrong configuration',
  'wrong image',
  'missing recording frame',
  'missing renderer confirmation',
])
  test(`saved result link rejects ${mutation}`, () => {
    // Arrange
    const study = createConfiguredStudy()
    const afterCapture = study.captures.find(
      (capture) => capture.phase === 'after',
    )
    if (!afterCapture || afterCapture.status !== 'captured')
      throw new Error('Expected a sealed result frame.')
    const content = summaryFor(
      study.observations[0]!.snapshotUri,
      study.observations[0]!.source.hash,
    )
    content.steps[1] = {
      id: 'result',
      from: 'interface',
      to: 'interface',
      label: 'Theme changed',
      explanation: 'The after predicate and frame verify dark mode.',
      evidence: 'observed',
      reference: {
        kind: 'terminal',
        configurationHash: study.configurationHash,
        captureHash: afterCapture.hash,
      },
    }
    const interpretation = study.observations[0]!.interpretations[0]!
    study.learningSummary = {
      content,
      explanationId: interpretation.id,
      createdAt: interpretation.createdAt,
    }
    const context = buildRecordingContext(study, [], 1)
    const afterPhase = context.phases.find((phase) => phase.phase === 'after')
    if (!afterPhase) throw new Error('Expected an after recording phase.')
    afterPhase.requestedMs = 3000
    afterPhase.pixelsMs = 4000
    afterPhase.rendererConfirmedMs = 4100
    afterPhase.hash = afterCapture.hash
    // Act
    if (mutation === 'unverified result') study.operation!.afterVerified = false
    if (mutation === 'wrong configuration')
      content.steps[1]!.reference = {
        kind: 'terminal',
        configurationHash: 'f'.repeat(64),
        captureHash: afterCapture.hash,
      }
    if (mutation === 'wrong image')
      content.steps[1]!.reference = {
        kind: 'terminal',
        configurationHash: study.configurationHash,
        captureHash: 'f'.repeat(64),
      }
    if (mutation === 'missing recording frame') afterPhase.hash = undefined
    if (mutation === 'missing renderer confirmation')
      afterPhase.rendererConfirmedMs = undefined
    // Assert
    if (
      mutation !== 'missing recording frame' &&
      mutation !== 'missing renderer confirmation'
    )
      assert.throws(() => decodeRetainedStudy(study, study.workspaceKey))
    else
      assert.throws(
        () => validateRecordingContext(context, study.workspaceKey),
        /Recording pixels lack their earlier request|Learning summary result frame/,
      )
  })

for (const mutation of [
  'snapshot',
  'source hash',
  'explanation receipt',
  'explanation time',
])
  test(`saved learning rejects a changed ${mutation} on archive and recording reload`, () => {
    // Arrange
    const study = createConfiguredStudy(),
      observation = study.observations[0]!,
      interpretation = observation.interpretations[0]!
    study.learningSummary = {
      content: summaryFor(observation.snapshotUri, observation.source.hash),
      explanationId: interpretation.id,
      createdAt: interpretation.createdAt,
    }
    const context = buildRecordingContext(study, [], 1),
      changed = structuredClone(study.learningSummary)
    const sourceReference = changed.content.steps[0]?.reference
    if (!sourceReference || !('snapshotUri' in sourceReference))
      throw new Error('Expected a recorded source reference.')
    // Act
    if (mutation === 'snapshot') sourceReference.snapshotUri += '/foreign'
    if (mutation === 'source hash') sourceReference.sourceHash = 'f'.repeat(64)
    if (mutation === 'explanation receipt')
      changed.explanationId = '99999999-9999-4999-8999-999999999999'
    if (mutation === 'explanation time')
      changed.createdAt = '2026-09-21T00:00:00.000Z'
    // Assert
    assert.throws(
      () =>
        decodeRetainedStudy(
          { ...study, learningSummary: changed },
          study.workspaceKey,
        ),
      /Learning summary/,
    )
    assert.throws(
      () =>
        validateRecordingContext(
          { ...context, study: { ...context.study, learningSummary: changed } },
          study.workspaceKey,
        ),
      /Learning summary/,
    )
  })

test('recorded step navigation supports prototype-shaped identifiers without inventing unrecorded positions', () => {
  // Arrange
  const study = createConfiguredStudy(),
    observation = study.observations[0]!,
    interpretation = observation.interpretations[0]!
  const content = summaryFor(observation.snapshotUri, observation.source.hash)
  content.steps[0]!.id = '__proto__'
  content.steps[1]!.id = 'constructor'
  study.learningSummary = {
    content,
    explanationId: interpretation.id,
    createdAt: interpretation.createdAt,
  }
  // Act
  const projected = projectLearningSummary(study)!
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(projected.positions)), [
    { stepId: '__proto__', elapsedMs: 2000 },
  ])
  assert.equal(
    projected.positions.find((value) => value.stepId === 'constructor'),
    undefined,
  )
  assert.equal(
    presentationReadingPoseSchema.safeParse({
      fraction: 0,
      leadingOffsetPx: 0,
      scrollY: 0,
      valuesScrollLeft: 0,
      expanded: [],
      visited: [],
      focus: { kind: 'summary-step', id: '__proto__' },
    }).success,
    true,
  )
})

test('committed agent learning persists with its exact evidence and survives a failed replacement after restart', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'summary',
    })
    const record = service.record(receipt)
    await record.preparation
    service.action({ ...receipt, key: 'select', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!,
      sourceHash = snapshotSourceHashes(
        service.snapshot(record, snapshotUri),
      ).typescript
    const content = summaryFor(snapshotUri, sourceHash),
      input = {
        ...receipt,
        key: 'learning',
        snapshotUri,
        sourceHash,
        valuePaths: ['value:nextTheme'],
        interpretation: 'The selected theme is dark.',
        learningSummary: content,
      }
    const signature = service.state(record).materialSignature
    // Act
    const saved = await service.explain(input),
      resource = await readResource(service, saved.explanationUri)
    const library = new LearningLibrary(
      join(harness.directory, 'saved-learning'),
      '0'.repeat(64),
    )
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    await library.saveStudy(archive)
    harness.runtimes[0]!.evidence.save = async () => {
      throw new Error('ENOSPC')
    }
    await assert.rejects(
      service.explain({
        ...input,
        key: 'replacement',
        learningSummary: { ...content, summary: 'Uncommitted replacement' },
      }),
      { code: 'EVIDENCE_UNAVAILABLE' },
    )
    const afterFailure = await captureStudy(
      service,
      record,
      library.workspaceKey,
    )
    const restored = await new LearningLibrary(
      library.directory,
      library.workspaceKey,
    ).readCheckpoint(archive.id)
    // Assert
    assert.ok('text' in resource)
    assert.deepEqual(JSON.parse(resource.text).learningSummary, content)
    assert.equal(JSON.parse(resource.text).learnerUnderstandingChanged, false)
    assert.notEqual(archive.materialSignature, signature)
    assert.deepEqual(afterFailure?.learningSummary, archive.learningSummary)
    assert.deepEqual(restored.study.learningSummary?.content, content)
    assert.equal(restored.status, 'saved')
    assert.equal(record.explanations.size, 1)
    assert.deepEqual(await service.explain(input), saved)
    assert.throws(
      () =>
        service.explain({
          ...input,
          learningSummary: {
            ...content,
            summary: 'Different material with the same retry key',
          },
        }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    )
  } finally {
    await harness.close()
  }
})

test('an active run cannot save a result step before its after condition and frame are verified', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'premature-result',
    })
    const record = service.record(receipt)
    await record.preparation
    service.action({
      ...receipt,
      key: 'change-theme',
      action: 'repository-click',
    })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const sourceHash = snapshotSourceHashes(
      service.snapshot(record, snapshotUri),
    ).typescript
    const content = summaryFor(snapshotUri, sourceHash)
    content.steps[1] = {
      id: 'result',
      from: 'interface',
      to: 'interface',
      label: 'Theme changed',
      explanation: 'A later frame would show dark mode.',
      evidence: 'observed',
      reference: {
        kind: 'terminal',
        configurationHash: service.state(record).configurationHash!,
        captureHash: 'a'.repeat(64),
      },
    }
    // Act / Assert
    assert.equal(service.state(record).terminalReference, undefined)
    assert.throws(
      () =>
        service.explain({
          ...receipt,
          key: 'premature-explanation',
          snapshotUri,
          sourceHash,
          valuePaths: ['value:nextTheme'],
          interpretation: 'The selected theme is dark.',
          learningSummary: content,
        }),
      { code: 'INVALID_REFERENCE' },
    )
    assert.equal(record.explanationKeys.size, 0)
  } finally {
    await harness.close()
  }
})

test('a stopped demonstrated run exposes its result reference and accepts a later complete learning summary', async () => {
  // Arrange
  class DemonstratedRuntime extends ControlledRuntime {
    override view(): ConfiguredRuntimeView {
      const state = super.view()
      if (!this.stopped) return state
      return {
        ...state,
        status: 'completed',
        runtimeOutcome: 'demonstrated',
        captureOutcome: 'complete',
        finalOutcome: 'demonstrated',
        operation: state.operation && {
          ...state.operation,
          afterVerified: true,
        },
      }
    }
  }
  const harness = await createHarness({
    create: async (directory, definition) =>
      new DemonstratedRuntime(directory, definition),
  })
  const service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'complete-result',
    })
    const record = service.record(receipt)
    await record.preparation
    service.action({
      ...receipt,
      key: 'change-theme',
      action: 'repository-click',
    })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const sourceHash = snapshotSourceHashes(
      service.snapshot(record, snapshotUri),
    ).typescript
    const pause = service.state(record).participants.browser.continueArguments!
    await service.continue(pause)
    await service.stop(receipt)
    const terminalReference = service.state(record).terminalReference
    if (!terminalReference)
      throw new Error('Expected a demonstrated terminal reference.')
    const content = summaryFor(snapshotUri, sourceHash)
    content.steps[1] = {
      id: 'result',
      from: 'interface',
      to: 'interface',
      label: 'Theme changed',
      explanation: 'The verified after frame shows dark mode.',
      evidence: 'observed',
      reference: terminalReference,
    }
    // Act
    const saved = await service.explain({
      ...receipt,
      key: 'complete-explanation',
      snapshotUri,
      sourceHash,
      valuePaths: ['value:nextTheme'],
      interpretation:
        'The stop selected dark mode; the result was verified later.',
      learningSummary: content,
    })
    const resource = await readResource(service, saved.explanationUri)
    // Assert
    assert.ok('text' in resource)
    assert.deepEqual(
      JSON.parse(resource.text).learningSummary.steps[1].reference,
      terminalReference,
    )
    assert.equal(record.explanations.size, 1)
  } finally {
    await harness.close()
  }
})

for (const mutation of ['foreign snapshot', 'wrong source'])
  test(`agent learning rejects ${mutation} before any explanation commits`, async () => {
    // Arrange
    const harness = await createHarness(),
      service = harness.service
    try {
      const receipt = service.start({
        instanceId: service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: 'references',
      })
      const record = service.record(receipt)
      await record.preparation
      service.action({ ...receipt, key: 'select', action: 'repository-click' })
      const snapshotUri =
          service.state(record).participants.browser.snapshotUri!,
        sourceHash = snapshotSourceHashes(
          service.snapshot(record, snapshotUri),
        ).typescript
      const content = summaryFor(snapshotUri, sourceHash)
      const sourceReference = content.steps[0]?.reference
      if (!sourceReference || !('snapshotUri' in sourceReference))
        throw new Error('Expected a recorded source reference.')
      // Act
      if (mutation === 'foreign snapshot')
        sourceReference.snapshotUri += '/other-run'
      else sourceReference.sourceHash = 'f'.repeat(64)
      // Assert
      assert.throws(
        () =>
          service.explain({
            ...receipt,
            key: 'invalid',
            snapshotUri,
            sourceHash,
            valuePaths: [],
            interpretation: 'Unverified material',
            learningSummary: content,
          }),
        { code: 'INVALID_REFERENCE' },
      )
      assert.equal(record.explanations.size, 0)
      assert.equal(record.explanationKeys.size, 0)
    } finally {
      await harness.close()
    }
  })

test('learning material rejects aggregate multibyte overflow even when every individual field fits', () => {
  // Arrange
  const content = summaryFor('codebook://snapshot', 'a'.repeat(64))
  content.steps = Array.from({ length: 64 }, (_, index) => ({
    ...content.steps[0]!,
    id: `step-${index}`,
    explanation: '学'.repeat(8192),
  }))
  // Act / Assert
  assert.equal(learningSummarySchema.safeParse(content).success, false)
})

test('an explanation without observed facts is refused before reserving a key or corrupting saved learning', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'empty-facts',
    })
    const record = service.record(receipt)
    await record.preparation
    service.action({ ...receipt, key: 'select', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const sourceHash = snapshotSourceHashes(
      service.snapshot(record, snapshotUri),
    ).typescript
    const input = {
      ...receipt,
      key: 'explanation',
      snapshotUri,
      sourceHash,
      valuePaths: [],
      interpretation: 'An unsupported interpretation.',
    }
    // Act / Assert
    assert.throws(() => service.explain(input), { code: 'INVALID_REFERENCE' })
    assert.equal(record.explanationKeys.size, 0)
    assert.equal(record.explanations.size, 0)
    await service.explain({
      ...input,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The recorded selected theme is dark.',
    })
    const library = new LearningLibrary(
      join(harness.directory, 'saved-learning'),
      '0'.repeat(64),
    )
    const archive = await captureStudy(service, record, library.workspaceKey)
    assert.ok(archive)
    await library.saveStudy(archive)
    assert.equal((await library.readCheckpoint(archive.id)).status, 'saved')
    assert.deepEqual(archive.observations[0]!.interpretations[0]!.facts, [
      { path: 'value:nextTheme', value: 'dark' },
    ])
  } finally {
    await harness.close()
  }
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  REPOSITORY_BROWSER_PROFILE as PROFILE_ID,
  REPOSITORY_RUN_TIMEOUT_MS as RUN_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { snapshotSourceHashes } from '../utils/snapshotSourceHashes'

import { ControlledRuntime, createHarness } from './helpers'

test('runtime success remains pending or partial until the latest terminal reader checkpoint is saved', async () => {
  // Arrange: the runtime outcome is injected; this tests the product persistence contract, not execution success.
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'history-outcome',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)
    runtime.view = () => ({
      ...view(),
      finalOutcome: 'demonstrated',
      operation: runtime.operation && {
        ...runtime.operation,
        afterVerified: true,
        continuedPause: runtime.snapshot?.pause,
      },
    })
    const stopped = await service.stop(receipt)
    assert.equal(stopped.finalOutcome, 'demonstrated')
    assert.equal(stopped.historyOutcome.status, 'unavailable')
    assert.equal(stopped.studyOutcome, 'partial')
    // Act
    const signature = service.state(record).materialSignature,
      first = service.beginHistory(record, signature)!
    assert.equal(service.state(record).studyOutcome, 'pending')
    const latest = service.beginHistory(record, signature)!
    service.reportHistory(
      record,
      signature,
      latest,
      'failed',
      'Storage limit exceeded',
    )
    const acceptedOldSave = service.reportHistory(
      record,
      signature,
      first,
      'saved',
    )
    // Assert
    assert.equal(acceptedOldSave, false)
    assert.equal(service.state(record).historyOutcome.status, 'failed')
    assert.equal((await service.stop(receipt)).studyOutcome, 'partial')
    assert.equal(
      service.state(record).historyOutcome.reason,
      'Storage limit exceeded',
    )
    const retry = service.beginHistory(record, signature)!
    assert.equal(service.reportHistory(record, signature, retry, 'saved'), true)
    assert.equal(service.state(record).studyOutcome, 'demonstrated')
    assert.equal(
      service.state(record).materialSignature,
      signature,
      'Receipt updates do not invalidate their own checkpoint',
    )
  } finally {
    await harness.close()
  }
})

test('a post-stop explanation invalidates the earlier saved checkpoint until its own material revision is persisted', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'late-interpretation',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    service.action({ ...receipt, key: 'one', action: 'repository-click' })
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)
    runtime.view = () => ({
      ...view(),
      finalOutcome: 'demonstrated',
      operation: runtime.operation && {
        ...runtime.operation,
        afterVerified: true,
        continuedPause: runtime.snapshot?.pause,
      },
    })
    await service.stop(receipt)
    const old = service.state(record),
      revision = service.beginHistory(record, old.materialSignature)!
    service.reportHistory(record, old.materialSignature, revision, 'saved')
    assert.equal(service.state(record).studyOutcome, 'demonstrated')
    // Act
    await service.explain({
      ...receipt,
      key: 'late',
      snapshotUri: old.observations[0]!.snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The captured price is 24.',
    })
    const changed = service.state(record)
    // Assert
    assert.notEqual(changed.materialSignature, old.materialSignature)
    assert.equal(changed.historyOutcome.status, 'pending')
    assert.equal(changed.studyOutcome, 'pending')
    assert.equal(
      service.reportHistory(record, old.materialSignature, revision, 'saved'),
      false,
    )
    const next = service.beginHistory(record, changed.materialSignature)!
    service.reportHistory(record, changed.materialSignature, next, 'saved')
    assert.equal((await service.stop(receipt)).studyOutcome, 'demonstrated')
  } finally {
    await harness.close()
  }
})

for (const shutdown of ['run stop', 'server shutdown'] as const) {
  test(`${shutdown} drains an accepted source display before releasing ownership and rejects later displays`, async () => {
    // Arrange
    const harness = await createHarness(),
      service = harness.service
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'source-owner',
    })
    let release!: () => void,
      entered = false,
      editorOpen = false,
      settled = false
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await service.record(receipt).preparation
      service.action({ ...receipt, key: 'click', action: 'repository-click' })
      const snapshotUri = service.state(service.record(receipt)).participants
          .browser.snapshotUri!,
        runtime = harness.runtimes[0]!
      const stop = runtime.stop.bind(runtime)
      runtime.reveal = async (): Promise<void> => {
        entered = true
        await barrier
        editorOpen = true
        runtime.evidence.record('agent.source-revealed')
      }
      runtime.stop = async (): Promise<void> => {
        editorOpen = false
        await stop()
      }
      const revealing = service.reveal({ ...receipt, snapshotUri })
      await waitUntil(() => entered, 'source acquisition', 1_000)
      // Act
      const stopping = (
        shutdown === 'run stop' ? service.stop(receipt) : service.shutdown()
      ).then(() => {
        settled = true
      })
      await Promise.resolve()
      await Promise.resolve()
      assert.equal(settled, false)
      assert.equal(runtime.releases, 0)
      release()
      await revealing
      await stopping
      // Assert
      assert.equal(editorOpen, false)
      assert.equal(service.resourcesReleased, true)
      assert.equal(runtime.releases, 1)
      const before = runtime.evidence.events.length
      await assert.rejects(
        service.reveal({ ...receipt, snapshotUri }),
        (error) =>
          error instanceof StudyError &&
          error.code === (shutdown === 'run stop' ? 'BUSY' : 'SERVER_STOPPING'),
      )
      assert.equal(runtime.evidence.events.length, before)
      const source = await readResource(
        service,
        `${snapshotUri}/source/typescript`,
      )
      assert.ok('text' in source)
      assert.equal(source.text, 'const nextTheme = "dark";\n')
    } finally {
      release()
      await harness.close()
    }
  })
}

test('repeated start intent creates one runtime and a conflicting key never silently changes its profile', async () => {
  // Arrange
  const harness = await createHarness()
  const service = harness.service
  const input = {
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'one',
  }
  try {
    // Act
    const first = service.start(input),
      second = service.start(input)
    const record = service.record(first)
    await record.preparation
    // Assert
    assert.deepEqual(second, first)
    assert.equal(harness.runtimes.length, 1)
    assert.throws(
      () => service.start({ ...input, profile: 'other' }),
      (error) =>
        error instanceof StudyError && error.code === 'IDEMPOTENCY_CONFLICT',
    )
    assert.throws(
      () => service.start({ ...input, key: 'overlap' }),
      (error) => error instanceof StudyError && error.code === 'BUSY',
    )
    assert.equal(service.state(record).state, 'ready')
  } finally {
    await harness.close()
  }
})

test('stop during delayed runtime acquisition waits and releases the late resource without preparing it', async () => {
  // Arrange
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  let acquiring = false
  const harness = await createHarness({
    create: async (directory) => {
      acquiring = true
      await barrier
      return new ControlledRuntime(directory)
    },
  })
  const service = harness.service,
    receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'late',
    })
  try {
    await waitUntil(() => acquiring, 'acquisition', 1_000)
    // Act
    let stopped = false
    const stopping = service.stop(receipt).then(() => {
      stopped = true
    })
    await Promise.resolve()
    assert.equal(stopped, false)
    release()
    await stopping
    // Assert
    assert.equal(harness.runtimes[0]?.releases, 1)
    assert.equal(harness.runtimes[0]?.status, 'preparing')
    assert.equal(service.state(service.record(receipt)).cleaned, true)
  } finally {
    release()
    await harness.close()
  }
})

test('shutdown during prerequisite validation prevents a late runtime launch', async () => {
  // Arrange
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const harness = await createHarness({
    prerequisites: async () => {
      await barrier
      return { ready: true, missing: [] }
    },
  })
  const service = harness.service
  service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'late',
  })
  // Act
  const stopping = service.shutdown()
  release()
  await stopping
  // Assert
  assert.equal(harness.runtimes.length, 0)
  await harness.close()
})

test('an action submitted before readiness is rejected without dispatch and a replay after stop keeps its original receipt', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'ready',
  })
  const record = service.record(receipt)
  const action = {
    ...receipt,
    key: 'click',
    action: 'repository-click' as const,
  }
  try {
    // Act / Assert
    assert.throws(
      () => service.action(action),
      (error) => error instanceof StudyError && error.code === 'BUSY',
    )
    await record.preparation
    const first = service.action(action)
    await service.stop(receipt)
    assert.deepEqual(service.action(action), first)
    assert.equal(harness.runtimes[0]?.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('a failed prerequisite becomes an actionable terminal record and never creates a runtime', async () => {
  // Arrange
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: false,
      missing: ['codebook.nodeExecutable missing'],
    }),
  })
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'missing',
  })
  try {
    // Act
    await harness.service.record(receipt).preparation
    await harness.service.stop(receipt)
    const state = harness.service.state(harness.service.record(receipt))
    const listedRun = (await harness.service.status()).runs.find(
      (run) => run.runId === receipt.runId,
    )
    // Assert
    assert.equal(harness.runtimes.length, 0)
    assert.equal(state.error?.code, 'PREREQUISITE_MISSING')
    assert.match(state.terminalReason!, /nodeExecutable/)
    assert.equal(listedRun?.error?.code, 'PREREQUISITE_MISSING')
    assert.match(listedRun?.terminalReason ?? '', /nodeExecutable/)
  } finally {
    await harness.close()
  }
})

test('simultaneous continuation consumes only one exact pause and historical snapshots stay readable after expiry', async () => {
  // Arrange
  let now = 0
  const harness = await createHarness({ now: () => now }),
    service = harness.service
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'pause',
  })
  const record = service.record(receipt)
  try {
    await record.preparation
    service.action({ ...receipt, key: 'click', action: 'repository-click' })
    const state = service.state(record),
      continuation = state.participants.browser.continueArguments!
    // Act
    const results = await Promise.allSettled([
      service.continue(continuation),
      service.continue(continuation),
    ])
    now = RUN_TIMEOUT_MS + 1
    service.maintain()
    await service.stop(receipt)
    const snapshot = await readResource(
      service,
      state.participants.browser.snapshotUri!,
    )
    // Assert
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.equal(service.state(record).participants.browser.resumable, false)
    await assert.rejects(
      service.continue(continuation),
      (error) => error instanceof StudyError && error.code === 'STALE_PAUSE',
    )
    assert.ok('text' in snapshot)
    assert.equal(JSON.parse(snapshot.text).values['value:nextTheme'], 'dark')
    assert.equal(harness.runtimes[0]?.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('explanations publish captured values only after persistence and same-key callers share the pending write', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'explain',
    }),
    record = service.record(receipt)
  let release: (() => void) | undefined
  try {
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!,
      snapshot = service.snapshot(record, snapshotUri)
    const evidence = harness.runtimes[0]!.evidence,
      originalSave = evidence.save.bind(evidence)
    let entered = false
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    evidence.save = async (name, contents): Promise<void> => {
      entered = true
      await barrier
      await originalSave(name, contents)
    }
    const input = {
      ...receipt,
      key: 'explanation',
      snapshotUri,
      sourceHash: snapshotSourceHashes(snapshot).typescript,
      valuePaths: ['value:nextTheme', 'value:enabled'],
      interpretation: 'The theme is dark at the captured statement.',
    }
    // Act
    const first = service.explain(input),
      duplicate = service.explain(input)
    await waitUntil(() => entered, 'explanation write', 1_000)
    // Assert
    assert.equal(first, duplicate)
    assert.equal(record.explanations.size, 0)
    assert.throws(
      () => service.explain({ ...input, interpretation: 'different' }),
      (error) =>
        error instanceof StudyError && error.code === 'IDEMPOTENCY_CONFLICT',
    )
    release?.()
    const result = await first
    const resource = await readResource(service, result.explanationUri)
    assert.ok('text' in resource)
    const saved = JSON.parse(resource.text)
    assert.deepEqual(saved.capturedFacts, [
      { path: 'value:nextTheme', value: 'dark' },
      { path: 'value:enabled', value: false },
    ])
    assert.equal(saved.learnerUnderstandingChanged, false)
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(evidence.directory, `agent-explanation-${saved.id}.json`),
          'utf8',
        ),
      ),
      saved,
    )
  } finally {
    release?.()
    await harness.close()
  }
})

test('a failed explanation write never appears as committed history or a successful final outcome', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'storage',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!,
      snapshot = service.snapshot(record, snapshotUri)
    harness.runtimes[0]!.evidence.save = async () => {
      throw new Error('ENOSPC')
    }
    // Act / Assert
    await assert.rejects(
      service.explain({
        ...receipt,
        key: 'explain',
        snapshotUri,
        sourceHash: snapshotSourceHashes(snapshot).typescript,
        valuePaths: ['value:nextTheme'],
        interpretation: 'Price captured.',
      }),
      (error) =>
        error instanceof StudyError && error.code === 'EVIDENCE_UNAVAILABLE',
    )
    assert.equal(record.explanations.size, 0)
    assert.equal(service.state(record).finalOutcome, 'not-demonstrated')
  } finally {
    await harness.close()
  }
})

test('completed runtime resources are released without a further client request', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'complete',
  })
  try {
    await service.record(receipt).preparation
    harness.runtimes[0]!.status = 'completed'
    // Act
    service.maintain()
    await waitUntil(
      () => service.record(receipt).stopped,
      'automatic completion cleanup',
      1_000,
    )
    // Assert
    assert.equal(harness.runtimes[0]?.releases, 1)
    assert.equal(service.state(service.record(receipt)).cleaned, true)
  } finally {
    await harness.close()
  }
})

test('event pagination bounds response detail and a source resource retains the captured bytes', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'history',
  })
  try {
    const record = service.record(receipt)
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    for (let index = 0; index < 60; index += 1)
      harness.runtimes[0]!.evidence.record('test.detail', {
        text: 'x'.repeat(9_000),
      })
    // Act
    const page = await readResource(service, service.uri(record.id, 'events/0'))
    const source = await readResource(
      service,
      service.state(record).participants.browser.sourceUri!,
    )
    // Assert
    assert.ok('text' in page && 'text' in source)
    const parsed = JSON.parse(page.text)
    assert.equal(parsed.events.length, 50)
    assert.equal(parsed.events[1].detail.truncated, true)
    assert.match(parsed.nextUri, /events\/50$/)
    assert.equal(source.text, 'const nextTheme = "dark";\n')
    await assert.rejects(
      readResource(service, service.uri(record.id, 'events/-1')),
      /cursor/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=runs that hold history are never evicted to make room for a new one; fails_when=the retained-run bound evicts an ordinary run or stops refusing; why_new=the bound had no test; seam=none
test('a seventeenth start is refused while all sixteen retained runs hold history', async () => {
  // Arrange: sixteen ordinary runs, each prepared and stopped.
  const harness = await createHarness(),
    service = harness.service
  try {
    for (let run = 1; run <= 16; run++)
      await service.stop(
        service.start({
          instanceId: service.instanceId,
          profile: PROFILE_ID,
          configuration: harness.configuration,
          key: `run-${run}`,
        }),
      )
    // Act / Assert
    assert.throws(
      () =>
        service.start({
          instanceId: service.instanceId,
          profile: PROFILE_ID,
          configuration: harness.configuration,
          key: 'run-17',
        }),
      (error) =>
        error instanceof StudyError &&
        error.code === 'LIMIT_EXCEEDED' &&
        error.message ===
          'This instance retains at most 16 runs; no history was evicted.',
    )
    assert.equal(service.records.size, 16)
  } finally {
    await harness.close()
  }
})

// Value: protects=a run whose saved study the learner removed gives up its slot at the retained-run bound; fails_when=only refused runs are evicted, so removals cannot make room for a new run in a long editor session; why_new=eviction and removal are new; seam=none
test('a seventeenth start is accepted after the learner removed the saved study of one of sixteen retained runs', async () => {
  // Arrange: sixteen ordinary stopped runs; the study of the third one was removed by the learner.
  const harness = await createHarness(),
    service = harness.service
  try {
    const receipts = []
    for (let run = 1; run <= 16; run++) {
      const receipt = service.start({
        instanceId: service.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: `run-${run}`,
      })
      await service.stop(receipt)
      receipts.push(receipt)
    }
    const removed = service.record(receipts[2]!)
    service.excludeHistory(removed, 'removed-by-learner')
    // Act
    const seventeenth = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'run-17',
    })
    await service.record(seventeenth).preparation
    // Assert
    assert.equal(service.records.size, 16)
    assert.equal(service.records.has(removed.id), false)
    assert.equal(service.records.has(receipts[0]!.runId), true)
    assert.equal(service.records.has(seventeenth.runId), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=after a saved study went to the Trash, an agent that reads the run's evidence is told why it is gone instead of getting a raw file error or stale bytes; fails_when=a removed run keeps serving its manifest, events or explanations, or the bare run resource stops answering; why_new=a deletion left the evidence in place before, so nothing had to be refused; seam=none
test('the evidence resources of a run whose saved study the learner removed answer that the evidence is unavailable, and the run resource still answers', async () => {
  // Arrange: a stopped run with one committed explanation.
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'removed-evidence',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const explained = await service.explain({
      ...receipt,
      key: 'explanation',
      snapshotUri,
      sourceHash: snapshotSourceHashes(service.snapshot(record, snapshotUri))
        .typescript,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The theme is dark at the captured statement.',
    })
    await service.stop(receipt)
    const manifestUri = service.uri(record.id, 'manifest'),
      eventsUri = service.uri(record.id, 'events/0')
    const eventsBefore = await readResource(service, eventsUri)
    // Act
    service.excludeHistory(record, 'removed-by-learner')
    // Assert
    const unavailable = (error: unknown): boolean =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message === 'The learner moved this saved study to the Trash.'
    assert.ok('text' in eventsBefore)
    await assert.rejects(readResource(service, manifestUri), unavailable)
    await assert.rejects(readResource(service, eventsUri), unavailable)
    await assert.rejects(
      readResource(service, explained.explanationUri),
      unavailable,
    )
    const run = await readResource(service, service.uri(record.id))
    assert.ok('text' in run)
    assert.deepEqual(
      JSON.parse(run.text),
      JSON.parse(JSON.stringify(service.state(record))),
    )
    assert.equal(
      service.state(record).historyOutcome.reason,
      'The learner moved this saved study to the Trash.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an explanation is never written into an evidence directory that is in the Trash; fails_when=explain accepts a removed run and fails later with a raw file error, or writes a file; why_new=a stopped run accepts explanations, and its directory can now be gone; seam=none
test('an explanation for a run whose saved study the learner removed is refused as unavailable evidence and writes nothing', async () => {
  // Arrange: a stopped run with a captured stop.
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'removed-explain',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const sourceHash = snapshotSourceHashes(
      service.snapshot(record, snapshotUri),
    ).typescript
    await service.stop(receipt)
    const evidence = harness.runtimes[0]!.evidence
    let saves = 0
    evidence.save = async (): Promise<void> => {
      saves++
    }
    service.excludeHistory(record, 'removed-by-learner')
    // Act / Assert
    assert.throws(
      () =>
        service.explain({
          ...receipt,
          key: 'late',
          snapshotUri,
          sourceHash,
          valuePaths: ['value:nextTheme'],
          interpretation: 'The theme is dark.',
        }),
      (error) =>
        error instanceof StudyError &&
        error.code === 'EVIDENCE_UNAVAILABLE' &&
        error.message === 'The learner moved this saved study to the Trash.',
    )
    assert.equal(saves, 0)
    assert.equal(record.explanationKeys.size, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the evidence directory moves only after every explanation write that was already accepted has finished, and no new one starts meanwhile; fails_when=the removal runs while an explanation is still being written (the file lands in a directory that is already in the Trash, or the move takes a half-written file), or an explanation is accepted during the move; why_new=the removal did not touch the evidence directory before; seam=the evidence writer's save, held by the test
test('a removal of a run’s study waits for an explanation that is being written and refuses a new explanation until it has finished', async () => {
  // Arrange: a stopped run whose first explanation write is held open.
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'held-evidence',
    }),
    record = service.record(receipt)
  let releaseWrite = (): void => {},
    releaseRemoval = (): void => {}
  try {
    await record.preparation
    service.action({ ...receipt, key: 'module', action: 'repository-click' })
    const snapshotUri = service.state(record).participants.browser.snapshotUri!
    const explanation = {
      ...receipt,
      snapshotUri,
      sourceHash: snapshotSourceHashes(service.snapshot(record, snapshotUri))
        .typescript,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The theme is dark.',
    }
    await service.stop(receipt)
    const evidence = harness.runtimes[0]!.evidence,
      originalSave = evidence.save.bind(evidence)
    const order: string[] = []
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    evidence.save = async (name, contents): Promise<void> => {
      order.push('explanation write started')
      await writeHeld
      await originalSave(name, contents)
      order.push('explanation write finished')
    }
    const firstExplanation = service.explain({ ...explanation, key: 'first' })
    await waitUntil(() => order.length === 1, 'the held explanation write')
    const removalHeld = new Promise<void>((resolve) => {
      releaseRemoval = resolve
    })
    // Act: the removal starts while the write is held; a second explanation arrives during the removal.
    const removal = service.withEvidenceHeld(record, async () => {
      order.push('removal started')
      await removalHeld
      return 'removed'
    })
    const refusedWhileWaiting = explainRefusal(() =>
      service.explain({ ...explanation, key: 'second' }),
    )
    releaseWrite()
    await waitUntil(() => order.includes('removal started'), 'the removal')
    const refusedWhileMoving = explainRefusal(() =>
      service.explain({ ...explanation, key: 'third' }),
    )
    releaseRemoval()
    const removalResult = await removal
    await firstExplanation
    const acceptedAfterwards = await service.explain({
      ...explanation,
      key: 'fourth',
    })
    // Assert
    assert.deepEqual(order.slice(0, 3), [
      'explanation write started',
      'explanation write finished',
      'removal started',
    ])
    assert.equal(removalResult, 'removed')
    assert.deepEqual(refusedWhileWaiting, {
      code: 'BUSY',
      message:
        "The learner is deleting this run's saved study; wait for it to finish.",
    })
    assert.deepEqual(refusedWhileMoving, refusedWhileWaiting)
    assert.match(acceptedAfterwards.explanationUri, /\/explanations\//)
    assert.equal(record.explanationKeys.size, 2)
  } finally {
    releaseWrite()
    releaseRemoval()
    await harness.close()
  }
})

/** Reads the code and message of the {@link StudyError} a synchronous explain call throws, so a test can hard-code both. @example explainRefusal(() => service.explain(input)) // => { code: 'BUSY', message: '…' } */
function explainRefusal(explain: () => unknown): {
  code?: string
  message?: string
} {
  try {
    explain()
    return {}
  } catch (error) {
    return error instanceof StudyError
      ? { code: error.code, message: error.message }
      : { message: String(error) }
  }
}

// Value: protects=a removal that fails leaves the run able to take explanations again; fails_when=the hold is not released when the removal throws; why_new=the hold is new; seam=none
test('a removal that throws releases the run for explanations again', async () => {
  // Arrange
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'failed-hold',
    }),
    record = service.record(receipt)
  try {
    await record.preparation
    await service.stop(receipt)
    // Act
    await assert.rejects(
      service.withEvidenceHeld(record, async () => {
        throw new Error('Trash refused')
      }),
      /Trash refused/,
    )
    // Assert
    assert.equal(record.evidenceHeld, false)
  } finally {
    await harness.close()
  }
})

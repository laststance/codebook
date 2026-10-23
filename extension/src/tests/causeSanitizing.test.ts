import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { StudyError } from '../errors'
import type { RecordingStore } from '../recordingStore'

import { createHarness } from './helpers'

/** Starts a prepared browser run of the harness and gives its service, record and the opened repository's root. */
async function preparedBrowserRun(key: string) {
  const harness = await createHarness(),
    service = harness.service
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key,
  })
  const record = service.record(receipt)
  await record.preparation
  return { harness, service, receipt, record, workspace: harness.directory }
}

// Value: protects=codebook_status naming no private path: a prerequisite read that fails and a repository whose sources cannot be read give their causes with the opened repository's root as <storage>; fails_when=either line keeps the raw failure with the path; why_new=status() kept String(error) for both lines (F219); seam=the environment's prerequisites and the service's source listing fail with the workspace root in their text; no_claim=the wording of the missing entries a working environment gives
test('codebook_status words a failed prerequisite read and an unreadable repository without a private path', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.environment.prerequisites = async () => {
    throw new Error(`cannot read ${harness.directory}/package.json`)
  }
  service.sources = async () => {
    throw new Error(`cannot list ${harness.directory}/src`)
  }
  try {
    // Act
    const status = await service.status()

    // Assert
    assert.deepEqual(
      [
        [...status.prerequisites.missing],
        status.repository.ready,
        status.repository.reason,
      ],
      [
        ['cannot read <storage>/package.json'],
        false,
        'cannot list <storage>/src',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=codebook_status naming no private path in the missing prerequisites a working read reports: a file error quoted in a missing sentence, common or of a profile, reads the repository root as <storage> while Codebook's own sentences stay as they were (F257); fails_when=a missing sentence keeps the raw file error with the repository's path; why_new=PR-1's /ship red team: only a failed prerequisite read was sanitized (F219), not the sentences of a read that resolves; seam=the environment's prerequisites resolve with the root in their sentences; no_claim=which prerequisites the environment checks
test('codebook_status words the missing prerequisites of a working read without a private path', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.environment.prerequisites = async () => ({
    ready: false,
    missing: [
      `EACCES: permission denied, lstat '${harness.directory}/.next'`,
      'The bundled JavaScript Debugger is unavailable.',
    ],
    profiles: {
      [PROFILE_ID]: {
        ready: false,
        missing: [
          `EACCES: permission denied, lstat '${harness.directory}/.next'`,
        ],
      },
    },
  })
  try {
    // Act
    const status = await service.status()

    // Assert
    assert.deepEqual(
      [
        [...status.prerequisites.missing],
        [...(status.profiles[0]?.prerequisites.missing ?? [])],
      ],
      [
        [
          "EACCES: permission denied, lstat '<storage>/.next'",
          'The bundled JavaScript Debugger is unavailable.',
        ],
        ["EACCES: permission denied, lstat '<storage>/.next'"],
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the causeDetail of a refused action and of a refused continue carrying <storage> where the runtime's failure named the repository root; fails_when=either cause keeps the raw path; why_new=action and continue put String(error) into the cause (F219); seam=the runtime's action and continue throw with the root in their text; no_claim=the BUSY and STALE_PAUSE classification (the conflict tests)
test('a refused action and a refused continue name no private path in their cause', async () => {
  // Arrange
  const { harness, service, receipt, record, workspace } =
    await preparedBrowserRun('cause-action')
  try {
    const runtime = harness.runtimes[0]!
    runtime.action = () => {
      throw new Error(`dispatch failed at ${workspace}/src/theme.ts`)
    }
    const actionRefusal = await Promise.resolve()
      .then(() =>
        service.action({
          ...receipt,
          key: 'click',
          action: 'repository-click',
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    delete (runtime as { action?: unknown }).action
    service.action({ ...receipt, key: 'click-2', action: 'repository-click' })
    const continuation =
      service.state(record).participants.browser.continueArguments!
    runtime.continue = async () => {
      throw new Error(`resume failed at ${workspace}/src/theme.ts`)
    }

    // Act
    const continueRefusal = await service.continue(continuation).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(actionRefusal instanceof StudyError)
    assert.ok(continueRefusal instanceof StudyError)
    assert.deepEqual(
      [actionRefusal.causeDetail, continueRefusal.causeDetail],
      [
        'dispatch failed at <storage>/src/theme.ts',
        'resume failed at <storage>/src/theme.ts',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the reason of a failed recording-context save reading <storage> where the failure named the service's storage root; fails_when=recordingReceipt.reason keeps the raw failure; why_new=the receipt's reason was String(error) (F219); seam=the archive refuses every read but its signature with a message naming the storage root; no_claim=a real full disk
test('a failed recording-context save keeps no storage path in the receipt’s reason', async () => {
  // Arrange
  const { harness, service, record } = await preparedBrowserRun('cause-receipt')
  try {
    service.recordings = {} as RecordingStore
    record.recording = {
      state: () => undefined,
    } as unknown as NonNullable<typeof record.recording>
    const signature = service.state(record).materialSignature
    const revision = service.beginHistory(record, signature)!
    service.reportHistory(record, signature, revision, 'saved')
    const storage = service.causeRoots.storage[0]!
    const archive = new Proxy(
      { materialSignature: signature },
      {
        get(target, property) {
          if (property in target) return Reflect.get(target, property)
          throw new Error(`write failed in ${storage}/recording`)
        },
      },
    )

    // Act
    await service.saveRecordingContext(
      record,
      archive as unknown as Parameters<typeof service.saveRecordingContext>[1],
      revision,
    )

    // Assert
    assert.deepEqual(
      [record.recordingReceipt?.status, record.recordingReceipt?.reason],
      ['failed', 'write failed in <storage>/recording'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser run's own error naming no private path: a runtime that cannot be created, with the harness root, which is both the repository and the storage root, in its failure, ends the run with <storage> in the error's message and cause; fails_when=the error assigned at the preparation keeps the raw path for a browser run; why_new=only a test run's error was sanitized (F49); the browser run's was not (F219); seam=the environment's createRuntime throws; no_claim=the wording of a runtime's own first failure
test('a browser run whose runtime cannot be created ends with an error that names no private path', async () => {
  // Arrange
  const harness = await createHarness({
      create: async () => {
        throw new Error(`cannot start in ${harness.directory}/app`)
      },
    }),
    { service } = harness
  try {
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'cause-run-error',
    })
    const record = service.record(receipt)

    // Act
    await record.preparation

    // Assert
    assert.deepEqual(
      [record.error?.message, record.error?.causeDetail],
      [
        'The study operation failed. Cause: cannot start in <storage>/app',
        'cannot start in <storage>/app',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a long cause an agent or the learner reads: past the 8,192-character bound it is cut between characters, never inside a surrogate pair, and says it was cut (F258); fails_when=the cut leaves a lone surrogate that a renderer shows as a replacement character, or drops the end without a marker; why_new=PR-1's /ship Claude adversarial review: sanitizedCause cut UTF-16 code units; seam=none; no_claim=the 300-character display cut (cutCauseForDisplay tests)
test('a cause longer than its bound is cut whole characters short with the cut marker and no lone surrogate', async () => {
  // Arrange
  const harness = await createHarness()
  const longCause = `${'x'.repeat(8_191)}😀 and more of the failure`
  try {
    // Act
    const cause = harness.service.unexpectedFailure(
      new Error(longCause),
    ).causeDetail

    // Assert
    assert.doesNotMatch(cause, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    assert.equal(cause.length <= 8_192, true)
    assert.equal(cause.endsWith('… [cut]'), true)
    assert.equal(cause.startsWith('x'.repeat(8_185)), true)
  } finally {
    await harness.close()
  }
})

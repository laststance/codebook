import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Evidence } from '../runtimeSupport/evidence'

test('recording and debug events share the same monotonic receipt clock', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-')),
    evidence = new Evidence(directory)
  try {
    // Act
    const before = evidence.elapsedMs(),
      stopped = evidence.record('dap.stopped'),
      after = evidence.elapsedMs()
    // Assert
    assert.ok(before <= stopped.elapsedMs)
    assert.ok(stopped.elapsedMs <= after)
    assert.ok(after >= 0)
    await evidence.flush()
    assert.equal(
      JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8'))
        .elapsedMs,
      stopped.elapsedMs,
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('later input acknowledgements cannot rewrite the recorded observation or diverge from disk history', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-')),
    evidence = new Evidence(directory)
  const operation = {
    inputAcknowledged: false,
    nested: { moduleCount: 0 },
    requests: ['selected'],
  }
  try {
    // Act
    evidence.record('action.accepted', operation)
    operation.inputAcknowledged = true
    operation.nested.moduleCount = 1
    operation.requests.push('later')
    await evidence.flush()
    // Assert
    assert.deepEqual(evidence.events[0]?.detail, {
      inputAcknowledged: false,
      nested: { moduleCount: 0 },
      requests: ['selected'],
    })
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8')),
      evidence.events[0],
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('overlapping manifest writes leave the latest complete state after flushing', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const evidence = new Evidence(directory)
  await evidence.initialize()
  try {
    // Act
    const earlier = evidence.save('manifest.json', {
      status: 'preparing',
      padding: 'a'.repeat(100_000),
    })
    evidence.record('run.failed', { reason: 'disconnect' })
    const latest = evidence.save('manifest.json', {
      status: 'failed',
      cleaned: true,
    })
    await Promise.all([earlier, latest])
    await evidence.flush()
    // Assert
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
      { status: 'failed', cleaned: true },
    )
    assert.equal(
      JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8')).type,
      'run.failed',
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('immediate cleanup can record evidence before initialization finishes', async () => {
  // Arrange
  const parent = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const directory = join(parent, 'new', 'run')
  const evidence = new Evidence(directory)
  try {
    // Act
    evidence.record('cleanup.started')
    await evidence.save('manifest.json', { cleaned: true })
    await evidence.flush()
    // Assert
    assert.equal(
      JSON.parse(await readFile(join(directory, 'events.jsonl'), 'utf8')).type,
      'cleanup.started',
    )
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
      { cleaned: true },
    )
  } finally {
    await rm(parent, { recursive: true })
  }
})

test('a bounded recorder stops retaining events at capacity and reports missing evidence instead of growing history', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const evidence = new Evidence(directory, {
    maxEvents: 2,
    retainedBytes: 10_000,
    queuedBytes: 10_000,
  })
  try {
    // Act
    evidence.record('first')
    evidence.record('second')
    evidence.record('overflow')
    for (let index = 0; index < 100; index += 1) evidence.record('ignored')
    // Assert
    assert.equal(evidence.events.length, 2)
    await assert.rejects(evidence.flush(), /buffering limit/)
    await assert.rejects(
      evidence.save('false-success.json', { success: true }),
      /buffering limit/,
    )
    assert.equal(
      (await readFile(join(directory, 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n').length,
      2,
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('retained bytes and queued bytes have separate limits even before the writer can drain', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const retained = new Evidence(join(directory, 'retained'), {
    maxEvents: 100,
    retainedBytes: 10,
    queuedBytes: 10_000,
  })
  const queued = new Evidence(join(directory, 'queued'), {
    maxEvents: 100,
    retainedBytes: 10_000,
    queuedBytes: 100,
  })
  try {
    // Act
    retained.record('too-large')
    const firstWrite = queued.save('first.txt', 'x'.repeat(80))
    const overCapacity = queued.save('second.txt', 'x'.repeat(80))
    // Observe both immediate rejections before yielding to the separate retained-byte writer.
    const rejectedWrites = Promise.all([
      assert.rejects(overCapacity, /queued write limit/),
      assert.rejects(firstWrite, /queued write limit/),
    ])
    // Assert
    assert.equal(retained.events.length, 0)
    await assert.rejects(retained.flush(), /buffering limit/)
    await rejectedWrites
    await assert.rejects(queued.flush(), /queued write limit/)
  } finally {
    await rm(directory, { recursive: true })
  }
})

// Value: protects=the journal of a run that fails after its evidence refused an event past its bound: the run's failure is the journal's last event, in the journal every reader reads (Evidence.events: the run's events resource, the end of its recording, the replay's paused intervals) and in events.jsonl, which is still writable after a refusal, while the refusal stays the evidence's failure; fails_when=the refusal drops run.failed like any other event, so the journal of the failed run ends without its failure; why_new=Cycle 0046 row 666 (the 653 fork's finding 2); seam=a recorder with a bound of two events
test('a run failure journaled after the evidence refused an event past its bound ends the journal and events.jsonl, and the refusal stays the evidence failure', async () => {
  // Arrange: the bound of two events is reached, and the third event is refused.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const evidence = new Evidence(directory, {
    maxEvents: 2,
    retainedBytes: 10_000,
    queuedBytes: 10_000,
  })
  try {
    evidence.record('first')
    evidence.record('second')
    evidence.record('overflow')

    // Act
    evidence.recordFailure(
      'Evidence buffering or persistence failed. Cause: Evidence buffering limit exceeded',
    )
    await evidence.flush().catch(() => undefined)

    // Assert
    const fileLines = (await readFile(join(directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      {
        journal: evidence.events.map(({ sequence, type, detail }) => ({
          sequence,
          type,
          detail,
        })),
        file: fileLines.map(({ sequence, type }) => ({ sequence, type })),
        failure: evidence.failure,
      },
      {
        journal: [
          { sequence: 1, type: 'first', detail: {} },
          { sequence: 2, type: 'second', detail: {} },
          {
            sequence: 3,
            type: 'run.failed',
            detail: {
              reason:
                'Evidence buffering or persistence failed. Cause: Evidence buffering limit exceeded',
            },
          },
        ],
        file: [
          { sequence: 1, type: 'first' },
          { sequence: 2, type: 'second' },
          { sequence: 3, type: 'run.failed' },
        ],
        failure: 'Evidence buffering limit exceeded',
      },
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

// Value: protects=the bound of a product adapter's journal after a refusal: only the first run failure is kept past it, so the journal grows by one event at most; fails_when=every failure recorded after the refusal is kept, so a run that reports failures in a loop grows its journal past every bound; why_new=Cycle 0046 row 666 (the bound of its fix); seam=a recorder with a bound of one event
test('only the first run failure is kept in the journal after the evidence refused an event past its bound', async () => {
  // Arrange: the bound of one event is reached, and the second event is refused.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-'))
  const evidence = new Evidence(directory, {
    maxEvents: 1,
    retainedBytes: 10_000,
    queuedBytes: 10_000,
  })
  try {
    evidence.record('first')
    evidence.record('overflow')

    // Act
    evidence.recordFailure('Selected debugger terminated')
    evidence.recordFailure('Selected browser CDP closed')
    await evidence.flush().catch(() => undefined)

    // Assert
    assert.deepEqual(
      evidence.events.map(({ type, detail }) => ({ type, detail })),
      [
        { type: 'first', detail: {} },
        {
          type: 'run.failed',
          detail: { reason: 'Selected debugger terminated' },
        },
      ],
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

// Value: protects=the journal of a run that fails after its evidence could not be written: the run's failure is still the last event of the journal every reader reads (Evidence.events), the evidence keeps its write failure, and the missing evidence directory is not created again by the failure's append; fails_when=the write failure drops run.failed; why_new=Cycle 0046 row 666 (the 653 fork's finding 2); seam=the recorder's directory, removed after its first event so that the next append fails
test('a run failure journaled after the evidence failed to write an event ends the journal, and the first write failure stays the evidence failure', async () => {
  // Arrange: the evidence directory is gone, so the second event's append fails.
  const parent = await mkdtemp(join(tmpdir(), 'codebook-evidence-test-')),
    directory = join(parent, 'run')
  const evidence = new Evidence(directory, {
    maxEvents: 100,
    retainedBytes: 10_000,
    queuedBytes: 10_000,
  })
  try {
    evidence.record('first')
    await evidence.flush()
    await rm(directory, { recursive: true })
    evidence.record('unwritten')
    await evidence.flush().catch(() => undefined)
    const firstFailure = evidence.failure

    // Act
    evidence.recordFailure('Selected debugger terminated')
    await evidence.flush().catch(() => undefined)

    // Assert
    assert.deepEqual(
      {
        firstFailureIsMissingFile: firstFailure?.startsWith(
          'Error: ENOENT: no such file or directory',
        ),
        journal: evidence.events.map(({ type }) => type),
        failureKept: evidence.failure === firstFailure,
        directoryCreatedAgain: await readdir(parent).then((names) =>
          names.includes('run'),
        ),
      },
      {
        firstFailureIsMissingFile: true,
        journal: ['first', 'unwritten', 'run.failed'],
        failureKept: true,
        directoryCreatedAgain: false,
      },
    )
  } finally {
    await rm(parent, { recursive: true })
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_SERVER_ORPHANS_STORAGE_KEY } from '../constants'
import { forgetNodeServerProcess } from '../utils/forgetNodeServerProcess'
import type {
  NodeServerOrphanRecord,
  NodeServerOrphanStore,
} from '../utils/nodeServerOrphanRecords'
import { reapNodeServerOrphans } from '../utils/reapNodeServerOrphans'
import { rememberNodeServerProcess } from '../utils/rememberNodeServerProcess'

const RECORD: NodeServerOrphanRecord = {
  runId: 'run-1',
  pid: 4242,
  processGroup: 4242,
  leaderStartedAt: 'ps:Tue Oct 28 10:00:00 2026',
  cwd: '/work/api',
  inspectorPort: 9229,
  declaredPort: 4100,
}

/**
 * Builds an in-memory store of the Memento shape.
 * @param initial - What is stored under the orphan key at first.
 * @returns The store and the values written.
 * @example memento([RECORD])
 */
function memento(initial: unknown): NodeServerOrphanStore & { value: unknown } {
  const store = {
    value: initial,
    get: (key: string): unknown =>
      key === NODE_SERVER_ORPHANS_STORAGE_KEY ? store.value : undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      if (key === NODE_SERVER_ORPHANS_STORAGE_KEY) store.value = value
    },
  }
  return store
}

// protects=a run's record is kept until its group is closed and replaced per run; fails_when=a second run drops the first or forget removes other runs; no_claim=storage durability
test('remembering and forgetting keep other runs records', async () => {
  // Arrange
  const store = memento(undefined)
  const other = { ...RECORD, runId: 'run-2', pid: 4343, processGroup: 4343 }
  // Act
  await rememberNodeServerProcess(store, RECORD)
  await rememberNodeServerProcess(store, other)
  await forgetNodeServerProcess(store, 'run-1')
  // Assert
  assert.deepEqual(store.value, [other])
})

// protects=a leader whose start and folder still match is closed TERM then KILL and logged without a private path; fails_when=the group is not signalled, KILL is skipped when the group stays, or the log names the folder; no_claim=real signals
test('a matching orphan group gets SIGTERM then SIGKILL when it stays, and one plain log line', async () => {
  // Arrange
  const store = memento([RECORD])
  const signals: string[] = []
  const lines: string[] = []
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => false,
    log: (line) => lines.push(line),
    graceMs: 120,
  })
  // Assert
  assert.equal(closed, 1)
  assert.deepEqual(signals, ['SIGTERM:4242', 'SIGKILL:4242'])
  assert.deepEqual(lines, [
    'Closed a server left running by an earlier window (pid 4242, declared port 4100).',
  ])
  assert.equal(store.value, undefined)
})

// protects=a group that exits after SIGTERM is not killed; fails_when=KILL is sent anyway; no_claim=timing precision
test('an orphan group that exits after SIGTERM receives no SIGKILL', async () => {
  // Arrange
  const store = memento([RECORD])
  const signals: string[] = []
  let gone = false
  // Act
  await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => {
      signals.push(`${signal}:${group}`)
      gone = true
    },
    isGroupGone: () => gone,
    log: () => undefined,
    graceMs: 1_000,
  })
  // Assert
  assert.deepEqual(signals, ['SIGTERM:4242'])
})

// protects=a recycled pid is never signalled (start or folder differs, or the process is gone); fails_when=any signal is sent for a non-matching record; no_claim=none
test('records whose leader start or folder differs or is gone are dropped without any signal', async () => {
  // Arrange
  const store = memento([
    { ...RECORD, runId: 'a' },
    { ...RECORD, runId: 'b' },
    { ...RECORD, runId: 'c' },
  ])
  const signals: string[] = []
  const starts = new Map([[4242, 'ps:another start']])
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    readProcessStart: async (pid) => starts.get(pid),
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => true,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.equal(closed, 0)
  assert.deepEqual(signals, [])
  assert.equal(store.value, undefined)
})

// protects=same start but another folder is not our server; fails_when=the folder is not compared; no_claim=none
test('a record whose process runs in another folder is dropped without any signal', async () => {
  // Arrange
  const store = memento([RECORD])
  const signals: string[] = []
  // Act
  await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => '/elsewhere',
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => true,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.deepEqual(signals, [])
})

// protects=a damaged store never signals or throws; fails_when=malformed entries are used or crash activation; no_claim=VS Code's storage
test('malformed stored records are dropped, valid ones kept for judgement', async () => {
  // Arrange
  const store = memento([
    { runId: 'x', pid: 'not a number' },
    'garbage',
    RECORD,
  ])
  const signals: string[] = []
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => true,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.equal(closed, 1)
  assert.deepEqual(signals, ['SIGTERM:4242'])
  assert.equal(store.value, undefined)
})

// protects=a non-array store value is ignored; fails_when=a corrupted store value crashes the sweep; no_claim=none
test('a store holding a non-list value is emptied without any signal', async () => {
  // Arrange
  const store = memento({ unexpected: true })
  const signals: string[] = []
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.equal(closed, 0)
  assert.deepEqual(signals, [])
  assert.equal(store.value, undefined)
})

// protects=one record's failure never skips the others and handled records leave the store; fails_when=a throwing reader aborts the sweep or leaves swept records; no_claim=the log wording
test('a record whose reader throws does not stop the sweep of the next record', async () => {
  // Arrange
  const first = { ...RECORD, runId: 'first', pid: 4242, processGroup: 4242 }
  const second = { ...RECORD, runId: 'second', pid: 4343, processGroup: 4343 }
  const store = memento([first, second])
  const signals: string[] = []
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    readProcessStart: async (pid) => {
      if (pid === 4242) throw new Error('ps failed')
      return RECORD.leaderStartedAt
    },
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => true,
    readOwnProcessGroup: async () => 1,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.equal(closed, 1)
  assert.deepEqual(signals, ['SIGTERM:4343'])
  assert.equal(store.value, undefined)
})

// protects=a record written while the sweep waits survives it; fails_when=the sweep clears the whole key; no_claim=concurrent writers beyond one
test('a record written during the sweep is kept when the sweep finishes', async () => {
  // Arrange
  const store = memento([RECORD])
  const live = { ...RECORD, runId: 'live', pid: 9001, processGroup: 9001 }
  // Act
  await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: () => {
      // A run starts while the orphan is being closed.
      store.value = [...(store.value as unknown[]), live]
    },
    isGroupGone: () => true,
    readOwnProcessGroup: async () => 1,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.deepEqual(store.value, [live])
})

// protects=a tampered record never makes the sweep signal a group its leader does not lead or the editor's own; fails_when=SIGTERM goes to any recorded group; no_claim=real groups
test("a record whose group is not led by its pid, or is the editor's own group, is dropped without any signal", async () => {
  // Arrange
  const store = memento([
    { ...RECORD, runId: 'foreign-group', pid: 4242, processGroup: 1111 },
    { ...RECORD, runId: 'own-group', pid: 5555, processGroup: 5555 },
  ])
  const signals: string[] = []
  // Act
  const closed = await reapNodeServerOrphans({
    store,
    readProcessStart: async () => RECORD.leaderStartedAt,
    readProcessCwd: async () => RECORD.cwd,
    signalGroup: (group, signal) => signals.push(`${signal}:${group}`),
    isGroupGone: () => true,
    readOwnProcessGroup: async () => 5555,
    log: () => undefined,
    graceMs: 50,
  })
  // Assert
  assert.equal(closed, 0)
  assert.deepEqual(signals, [])
})

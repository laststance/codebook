import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SCRIPT_HISTORY_DIRECTORY,
  NODE_SERVER_HISTORY_DIRECTORY,
} from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildNodeScriptHistoryHeader } from '../utils/buildNodeScriptHistoryHeader'
import { describeScriptReplayRow } from '../utils/describeNodeScriptReplay'

import { createHarness } from './helpers'
import {
  runScriptHistory,
  SCRIPT_ENTRY,
  scriptMaterialCiting,
} from './utils/nodeScriptHistoryFixture'
import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const SOURCE_HASH = sha256(HANDLER_SOURCE_TEXT)

/** Parses the JSON a one-page resource carries in its `content`. */
function readPageContent(resource: Awaited<ReturnType<typeof readResource>>) {
  assert.ok('text' in resource)
  return JSON.parse(JSON.parse(resource.text).content)
}

/** Reads the one script history's summary the repository lists. */
async function onlyScriptSummary(
  repository: Awaited<ReturnType<typeof runScriptHistory>>['repository'],
) {
  const { scripts } = await repository.listByProfile()
  assert.equal(scripts.length, 1)
  return scripts[0]!
}

// protects=a script history lives in its own store folder, node-scripts.v1, and its header is a script header with no request; fails_when=the script store shares the server folder, the header keeps a declared request, or the repository does not resolve the id to the script profile; no_claim=that an older Codebook ignores the folder, which no older reader opens
test('a script history is created under node-scripts.v1 with a script header and resolves to the script profile', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const instanceId = randomUUID()
  const runId = randomUUID()
  const header = buildNodeScriptHistoryHeader({
    workspaceKey: repository.scriptHistories.workspaceKey,
    instanceId,
    runId,
    createdAtMs: Date.parse('2026-11-05T00:00:00.000Z'),
    packageRoot: 'examples/node',
    entry: SCRIPT_ENTRY,
    loader: 'tsx',
    declaredStops: [{ path: 'src/handler.ts', line: 2 }],
    sourceHashes: [{ path: 'src/handler.ts', hash: SOURCE_HASH }],
    repositoryRevision: { revision: 'abc1234', dirty: false },
  })

  // Act
  const writer = await repository.scriptHistories.start(header)
  writer.abandon()
  const folder = join(
    learningDirectory,
    NODE_SCRIPT_HISTORY_DIRECTORY,
    header.studyId,
  )
  const written = JSON.parse(
    await readFile(join(folder, 'header.json'), 'utf8'),
  )
  const serverFolders = await readdir(
    join(learningDirectory, NODE_SERVER_HISTORY_DIRECTORY),
  ).catch(() => [])

  // Assert
  assert.equal(written.profile, 'node-script')
  assert.equal(written.formatVersion, 1)
  assert.equal(written.packageRoot, 'examples/node')
  assert.equal(written.entry, SCRIPT_ENTRY)
  assert.equal(written.loader, 'tsx')
  assert.equal('declaredRequest' in written, false)
  assert.deepEqual(serverFolders, [])
  assert.equal(repository.resolve(header.studyId)?.profile, 'node-script')
})

// protects=a complete script run is sealed, saved with an explanation citing its stops and end, and listed as a Script replay with its entry, exit code and stops reached of declared; fails_when=the summary misses the end, counts the stops wrong, calls a covered run partial, or the row loses a part; no_claim=the replay UI that opens the row
test('a complete script run saved with its stops and end is listed as a Script replay with entry, exit code and stops reached', async (context) => {
  // Arrange
  const { repository, studyId } = await runScriptHistory(context, {
    declaredStops: 3,
    hits: [0, 1, 2],
    output: ['seeded 3 items\n'],
    end: {
      kind: 'exited',
      exitCode: 0,
      stopsReached: [0, 1, 2],
      stopsNeverReached: [],
    },
  })
  // Journal: output 1, source 2, stops 3 to 5, end 6.
  const material = scriptMaterialCiting([
    { type: 'stop', sequence: 3, sourceHash: SOURCE_HASH },
    { type: 'stop', sequence: 4, sourceHash: SOURCE_HASH },
    { type: 'stop', sequence: 5, sourceHash: SOURCE_HASH },
    { type: 'output', sequence: 1, channel: 'stdout' },
    { type: 'end', sequence: 6 },
  ])

  // Act
  await repository.scriptHistories.saveLearningMaterial(studyId, 0, material)
  const summary = await onlyScriptSummary(repository)

  // Assert
  assert.equal(summary.status, 'complete')
  assert.equal(summary.endKind, 'exited')
  assert.equal(summary.exitCode, 0)
  assert.equal(summary.reachedStopCount, 3)
  assert.equal(summary.declaredStopCount, 3)
  assert.equal(summary.captureComplete, true)
  assert.equal(summary.learningCoverage, 'complete')
  assert.equal(
    describeScriptReplayRow(summary),
    'Seeding the store · Script replay · scripts/seed.mjs → exit code 0 · 3 of 3 stops · Saved',
  )
})

// protects=a script that exited with a failure code is an observed end, not a gap in the capture; fails_when=a nonzero exit code makes the history partial or the row loses the code; no_claim=how the chat words the failure
test('a script that exits with code 3 after all its stops is a complete capture whose row shows the exit code', async (context) => {
  // Arrange
  const { repository } = await runScriptHistory(context, {
    declaredStops: 1,
    hits: [0],
    end: {
      kind: 'exited',
      exitCode: 3,
      stopsReached: [0],
      stopsNeverReached: [],
    },
  })

  // Act
  const summary = await onlyScriptSummary(repository)

  // Assert
  assert.equal(summary.captureComplete, true)
  assert.equal(
    describeScriptReplayRow(summary),
    "What does the seed script do? · Script replay · scripts/seed.mjs → exit code 3 · 1 of 1 stops · Partial: the chat's explanation is not saved yet",
  )
})

// protects=a partial run (two of three declared stops never reached) still seals, lists and names the missing stops and the unexplained parts; fails_when=the run is dropped, reads complete, or the reasons do not name the stops never reached; no_claim=the stops a later run would reach
test('a script run that reached one of three stops is listed as partial naming the two stops never reached and the parts the chat has not explained', async (context) => {
  // Arrange
  const { repository } = await runScriptHistory(context, {
    declaredStops: 3,
    hits: [0],
    end: {
      kind: 'exited',
      exitCode: 0,
      stopsReached: [0],
      stopsNeverReached: [1, 2],
    },
  })

  // Act
  const summary = await onlyScriptSummary(repository)

  // Assert
  assert.equal(summary.status, 'partial')
  assert.equal(summary.captureComplete, false)
  assert.deepEqual(
    summary.captureMissing.map((reason) => reason.text),
    ['Declared stop 2 was not reached.', 'Declared stop 3 was not reached.'],
  )
  // Journal: source 1, stop 2, end 3.
  assert.deepEqual(summary.learningMissing, [
    { type: 'stop', sequence: 2, declaredStopIndex: 0, hit: 1 },
    { type: 'end', sequence: 3 },
  ])
  assert.equal(
    describeScriptReplayRow(summary),
    'What does the seed script do? · Script replay · scripts/seed.mjs → exit code 0 · 1 of 3 stops · Partial: Declared stop 2 was not reached. (+1 more)',
  )
})

// protects=stops not reached before the capture budget was spent are not observed, and no summary calls them never reached; fails_when=a stop beyond the spent budget reads "was not reached", or the budget reason is missing; no_claim=the run's own budget accounting, which the run lane tests
test('a run that spent its 16-hit capture budget lists the stops after it as not observed and never as not reached', async (context) => {
  // Arrange
  const { repository } = await runScriptHistory(context, {
    declaredStops: 3,
    hits: Array.from({ length: 16 }, () => 0),
    budgetExhausted: true,
    end: {
      kind: 'exited',
      exitCode: 0,
      stopsReached: [0],
      stopsNeverReached: [],
      captureBudgetExhausted: true,
      stopsNotObserved: [1, 2],
    },
  })

  // Act
  const summary = await onlyScriptSummary(repository)

  // Assert
  assert.deepEqual(
    summary.captureMissing.map((reason) => reason.code),
    [
      'SCRIPT_HISTORY_STOP_NOT_OBSERVED',
      'SCRIPT_HISTORY_STOP_NOT_OBSERVED',
      'SERVER_HISTORY_CAPTURE_BUDGET_EXHAUSTED',
    ],
  )
  assert.equal(
    summary.captureMissing.some((reason) => /not reached/.test(reason.text)),
    false,
  )
  assert.match(
    describeScriptReplayRow(summary),
    /Declared stop 2 was not observed/,
  )
})

// protects=a run sealed without its own end (disposed or stopped by the editor) still seals with a stopped end derived from the stops recorded, and reads partial naming the stop; fails_when=the seal throws, writes no end, or lists the unreached stop as reached; no_claim=the run's real stop path
test("a history sealed without the run's end gets a stopped end that names the stop reached and the one never reached", async (context) => {
  // Arrange
  const { repository, studyId } = await runScriptHistory(context, {
    declaredStops: 2,
    hits: [0],
  })

  // Act
  const history = await repository.scriptHistories.read(studyId)
  const summary = await onlyScriptSummary(repository)

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type, 'end')
  assert.equal(end?.type === 'end' ? end.kind : undefined, 'stopped')
  assert.deepEqual(end?.type === 'end' ? end.stopsReached : undefined, [0])
  assert.deepEqual(end?.type === 'end' ? end.stopsNeverReached : undefined, [1])
  assert.deepEqual(
    summary.captureMissing.map((reason) => reason.code),
    ['SCRIPT_HISTORY_RUN_STOPPED', 'SERVER_HISTORY_STOP_NOT_REACHED'],
  )
})

// protects=the history repository counts the script store in its one store list, so a server save and a script save share the one place limit; fails_when=a store is left out of admission counting, so a server history is admitted beyond the limit or countHistories misses the script history; no_claim=the browser save's own admission
test('with room for two histories, a script and a server history fill the library and neither store admits a third', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context, { limit: 2 })
  await runScriptHistory(
    context,
    { declaredStops: 1, hits: [0], end: undefined },
    repository,
  )
  const { header } = await writeServerHistory(repository)

  // Act
  const counted = await repository.countHistories(10)
  const serverAdmission = repository.serverHistories
    .start({ ...header, instanceId: randomUUID(), runId: randomUUID() })
    .then(
      () => 'admitted',
      () => 'refused',
    )

  // Assert
  assert.equal(counted, 2)
  assert.equal(await serverAdmission, 'refused')
})

// protects=listing keeps script and server histories apart by profile while one catalog lists both newest first; fails_when=a script history shows in the server list, a server history in the script list, or the combined catalog drops one; no_claim=the existing server history format, whose own tests stay unchanged
test('a script history and a server history list under their own profiles and together in one catalog', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  await writeServerHistory(repository)
  await runScriptHistory(
    context,
    { declaredStops: 1, hits: [0], end: undefined },
    repository,
  )

  // Act
  const byProfile = await repository.listByProfile()
  const catalog = await repository.list()

  // Assert
  assert.equal(byProfile.servers.length, 1)
  assert.equal(byProfile.scripts.length, 1)
  assert.deepEqual(byProfile.unavailable, [])
  assert.deepEqual(catalog.map((entry) => entry.profile).sort(), [
    'node-script',
    'node-server',
  ])
})

// protects=codebook_explain_node_history saves a partial script run's explanation and its resource then states what the capture lacks and that the explanation covers the recorded parts; fails_when=the save is refused for a partial run, goes to another store, or the resource drops captureMissing; no_claim=a run that is still recording
test('saving a partial script run through the service stores the explanation and the history resource names the stops never reached', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const { studyId } = await runScriptHistory(
    context,
    {
      declaredStops: 3,
      hits: [0],
      end: {
        kind: 'exited',
        exitCode: 0,
        stopsReached: [0],
        stopsNeverReached: [1, 2],
      },
    },
    repository,
  )
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository

  // Act
  const saved = await harness.service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: scriptMaterialCiting([
      { type: 'stop', sequence: 2, sourceHash: SOURCE_HASH },
      { type: 'end', sequence: 3 },
    ]),
  })
  const resource = await readResource(
    harness.service,
    `codebook://node-history/${studyId}`,
  )
  const events = await readResource(
    harness.service,
    `codebook://node-history/${studyId}/events`,
  )

  // Assert
  assert.equal(saved.revision, 1)
  const body = readPageContent(resource)
  assert.equal(body.profile, 'node-script')
  assert.equal(body.saved, true)
  assert.equal(body.captureComplete, false)
  assert.equal(body.captureMissingCount, 2)
  assert.equal(body.learningCoverage, 'complete')
  assert.equal(body.materialRevision, 1)
  const eventTypes = readPageContent(events).map(
    (event: { type: string }) => event.type,
  )
  assert.deepEqual(eventTypes, ['stop', 'end'])
})

// protects=a learning step citing the end must cite the end entry: a step citing a stop sequence as the end is refused with an INVALID_REFERENCE naming the end; fails_when=the citation check lets a step claim a stop is the end; no_claim=citations of outputs, which share the server check
test('a step that cites a stop sequence as the end is refused as an invalid reference', async (context) => {
  // Arrange
  const { repository, studyId } = await runScriptHistory(context, {
    declaredStops: 1,
    hits: [0],
    end: {
      kind: 'exited',
      exitCode: 0,
      stopsReached: [0],
      stopsNeverReached: [],
    },
  })

  // Act
  const refusal = await repository.scriptHistories
    .saveLearningMaterial(
      studyId,
      0,
      // Journal: source 1, stop 2, end 3; sequence 2 is the stop.
      scriptMaterialCiting([{ type: 'end', sequence: 2 }]),
    )
    .catch((error: unknown) => error)

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_REFERENCE')
  assert.match(refusal.message, /the end/)
})

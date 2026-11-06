import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NODE_SCRIPT_HISTORY_DIRECTORY } from '../constants'
import { HISTORY_JOURNAL_FILE } from '../nodeHistoryJournalWriter'
import {
  nodeScriptHistoryEntrySchema,
  nodeScriptHistoryHeaderSchema,
  type NodeScriptEnd,
} from '../nodeScriptHistorySchemas'
import type { NodeScriptLibraryObservedFacts } from '../nodeScriptHistorySink'
import { nodeScriptStorageDescriptor } from '../nodeScriptStorageDescriptor'
import { NodeHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildNodeScriptHistoryHeader } from '../utils/buildNodeScriptHistoryHeader'
import { describeLibraryCorrespondence } from '../utils/describeLibraryCorrespondence'
import { presentScriptHistory } from '../utils/presentServerHistory'
import { projectServerSection } from '../utils/projectServerSection'

import { legacyNodeScriptHistoryHeaderSchema } from './utils/legacyNodeScriptHistoryHeaderSchema'
import {
  runScriptHistory,
  SCRIPT_ENTRY,
} from './utils/nodeScriptHistoryFixture'
import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const LIBRARY_IDENTITY = {
  package: '@reduxjs/toolkit',
  packageRoot: 'packages/toolkit',
}
const PREPARED_FACTS = {
  package: '@reduxjs/toolkit',
  version: '2.14.0',
  packageRoot: 'packages/toolkit',
  revision: '71147871234567890abcdef',
  dirty: false,
  packageManager: 'pnpm' as const,
  buildMs: 5_500,
  packMs: 620,
  tarballSha256: sha256('tarball'),
  installedVersion: '2.9.0',
}
const OBSERVED_FACTS = {
  loaded: true,
  loadCount: 4,
  otherCopyLoaded: false,
  observation: 'complete' as const,
}
const EXITED: NodeScriptEnd = {
  kind: 'exited',
  exitCode: 0,
  stopsReached: [],
  stopsNeverReached: [0],
}

/** Reads the journal's entries of one stored history, as parsed JSON lines. */
async function readJournal(
  learningDirectory: string,
  studyId: string,
): Promise<Array<{ type: string }>> {
  const text = await readFile(
    join(
      learningDirectory,
      NODE_SCRIPT_HISTORY_DIRECTORY,
      studyId,
      HISTORY_JOURNAL_FILE,
    ),
    'utf8',
  )
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/** Reads a stored JSON file of one history folder. */
async function readStoredJson(
  learningDirectory: string,
  studyId: string,
  name: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      join(learningDirectory, NODE_SCRIPT_HISTORY_DIRECTORY, studyId, name),
      'utf8',
    ),
  )
}

/** Builds a header input for a hand-driven writer, with or without the declared library. */
function headerFor(workspaceKey: string, withLibrary: boolean) {
  return buildNodeScriptHistoryHeader({
    workspaceKey,
    instanceId: randomUUID(),
    runId: randomUUID(),
    createdAtMs: Date.parse('2026-11-07T00:00:00.000Z'),
    packageRoot: '.',
    entry: SCRIPT_ENTRY,
    loader: 'node',
    declaredStops: [{ path: 'src/handler.ts', line: 2 }],
    sourceHashes: [
      { path: 'src/handler.ts', hash: sha256(HANDLER_SOURCE_TEXT) },
    ],
    repositoryRevision: { revision: 'abc1234', dirty: false },
    ...(withLibrary ? { library: LIBRARY_IDENTITY } : {}),
  })
}

// protects=a run with library writes header format 2 with the declared identity only, then library.prepared, library.observed and end in that order, with the seal still version 1; fails_when=the header stays format 1, carries build results, the events are missing or out of order, or the seal follows the header to version 2; no_claim=a real build (the facts are handed in by hand)
test('a run with library writes a format 2 header with its identity and the prepared, observed and end entries in order, sealed at version 1', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)

  // Act
  const { studyId } = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [],
      output: ['done\n'],
      end: EXITED,
      library: {
        identity: LIBRARY_IDENTITY,
        prepared: PREPARED_FACTS,
        observed: OBSERVED_FACTS,
      },
    },
    repository,
  )
  const header = await readStoredJson(learningDirectory, studyId, 'header.json')
  const seal = await readStoredJson(learningDirectory, studyId, 'sealed.json')
  const types = (await readJournal(learningDirectory, studyId)).map(
    (entry) => entry.type,
  )
  const { scripts } = await repository.listByProfile()

  // Assert
  assert.equal(header.formatVersion, 2)
  assert.deepEqual(header.library, {
    package: '@reduxjs/toolkit',
    packageRoot: 'packages/toolkit',
  })
  assert.equal(seal.version, 1)
  assert.deepEqual(types, [
    'library.prepared',
    'output',
    'library.observed',
    'end',
  ])
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0]!.verification, 'verified')
})

// protects=a run without library keeps header format 1 with no library key and no library entries; fails_when=every script history moves to format 2 or gains a library key; no_claim=that an older build opens it
test('a run without library keeps the format 1 header with no library key', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)

  // Act
  const { studyId } = await runScriptHistory(
    context,
    { declaredStops: 1, hits: [], output: ['done\n'], end: EXITED },
    repository,
  )
  const header = await readStoredJson(learningDirectory, studyId, 'header.json')

  // Assert
  assert.equal(header.formatVersion, 1)
  assert.equal('library' in header, false)
})

// protects=the header schemas are strict per format: format 2 needs the library, format 1 refuses it, and format 3 is refused; fails_when=format 2 parses without library, format 1 parses with it, or format 3 parses; no_claim=how the store words the refusal
test('header format 2 requires library, format 1 refuses it and format 3 is refused', () => {
  // Arrange
  const stored = {
    ...headerFor('a'.repeat(64), false),
  }
  const format1 = { formatVersion: 1, ...stored }
  const format2 = {
    formatVersion: 2,
    ...stored,
    library: LIBRARY_IDENTITY,
  }

  // Act / Assert
  assert.doesNotThrow(() => nodeScriptHistoryHeaderSchema.parse(format1))
  assert.doesNotThrow(() => nodeScriptHistoryHeaderSchema.parse(format2))
  assert.throws(() =>
    nodeScriptHistoryHeaderSchema.parse({ ...format2, library: undefined }),
  )
  assert.throws(() =>
    nodeScriptHistoryHeaderSchema.parse({
      ...format1,
      library: LIBRARY_IDENTITY,
    }),
  )
  assert.throws(() =>
    nodeScriptHistoryHeaderSchema.parse({ ...format2, formatVersion: 3 }),
  )
})

// protects=library entries are strict: an unknown key or an unknown observation is refused; fails_when=library.observed accepts a made-up observation word or an extra key; no_claim=the writer's ordering rules
test('a library.observed entry with an unknown observation or key is refused', () => {
  // Arrange
  const entry = {
    type: 'library.observed',
    sequence: 2,
    elapsedMs: 5,
    ...OBSERVED_FACTS,
  }

  // Act / Assert
  assert.doesNotThrow(() => nodeScriptHistoryEntrySchema.parse(entry))
  assert.throws(() =>
    nodeScriptHistoryEntrySchema.parse({ ...entry, observation: 'partial' }),
  )
  assert.throws(() =>
    nodeScriptHistoryEntrySchema.parse({ ...entry, extra: true }),
  )
})

// protects=the library entries appear only in a format 2 history, prepared before observed and each once; fails_when=a format 1 history takes a library entry, an observation comes without its preparation, or either entry repeats; no_claim=the run's own order, which lane D feeds
test('the writer refuses library entries in a format 1 history, an observation before its preparation and a repeated entry', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const plainWriter = await repository.scriptHistories.start(
    headerFor(repository.scriptHistories.workspaceKey, false),
  )
  const unpreparedWriter = await repository.scriptHistories.start(
    headerFor(repository.scriptHistories.workspaceKey, true),
  )
  const repeatingWriter = await repository.scriptHistories.start(
    headerFor(repository.scriptHistories.workspaceKey, true),
  )
  context.after(() => {
    plainWriter.abandon()
    unpreparedWriter.abandon()
    repeatingWriter.abandon()
  })

  // Act / Assert
  await assert.rejects(
    plainWriter.appendLibraryPrepared({ elapsedMs: 1, ...PREPARED_FACTS }),
    /format 2/,
  )
  await assert.rejects(
    unpreparedWriter.appendLibraryObserved({ elapsedMs: 1, ...OBSERVED_FACTS }),
    /never prepared/,
  )
  await repeatingWriter.appendLibraryPrepared({
    elapsedMs: 1,
    ...PREPARED_FACTS,
  })
  await assert.rejects(
    repeatingWriter.appendLibraryPrepared({ elapsedMs: 2, ...PREPARED_FACTS }),
    /twice/,
  )
})

// protects=a run that never started its script (built or not, stopped or failed) leaves no saved history, even though it recorded library.prepared; fails_when=the preparation alone makes the history worth keeping; no_claim=the run resource, which keeps the error
test('a library run that never started its script leaves no history', async (context) => {
  // Arrange / Act
  const { repository } = await runScriptHistory(context, {
    declaredStops: 1,
    hits: [],
    library: { identity: LIBRARY_IDENTITY, prepared: PREPARED_FACTS },
  })
  const { scripts } = await repository.listByProfile()

  // Assert
  assert.deepEqual(scripts, [])
})

// protects=an observation appended before end is kept and one appended after end is refused without a fault, so the run must append it between the tree's end and end; fails_when=a late observation is written after end, adds an append-failure reason to the seal, or an early one is dropped; no_claim=the run's ending order itself
test('library.observed is kept before end and an append after end writes nothing and adds no failure', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = headerFor(repository.scriptHistories.workspaceKey, true)
  const writer = await repository.scriptHistories.start(header)
  await writer.appendLibraryPrepared({ elapsedMs: 1, ...PREPARED_FACTS })
  await writer.appendEntry({
    type: 'output',
    elapsedMs: 2,
    channel: 'stdout',
    text: 'ok\n',
  })
  await writer.appendLibraryObserved({ elapsedMs: 3, ...OBSERVED_FACTS })

  // Act
  await writer.appendEnd({ elapsedMs: 4, ...EXITED })
  await writer.appendLibraryObserved({ elapsedMs: 5, ...OBSERVED_FACTS })
  await writer.seal()
  const types = (await readJournal(learningDirectory, header.studyId)).map(
    (entry) => entry.type,
  )
  const seal = await readStoredJson(
    learningDirectory,
    header.studyId,
    'sealed.json',
  )

  // Assert
  assert.deepEqual(types, [
    'library.prepared',
    'output',
    'library.observed',
    'end',
  ])
  // The only gap is the declared stop the run never reached: the late append added no append-failure reason.
  assert.deepEqual(
    (seal.reasons as Array<{ code: string }>).map((reason) => reason.code),
    ['SCRIPT_HISTORY_STOP_NOT_REACHED'],
  )
})

// protects=an older Codebook (the format 1 only header schema of 976c3922, kept as a fixture) neither lists nor deletes a format 2 history while it still lists format 1; fails_when=the old schema parses a format 2 header, the old store lists it, or its folder is gone after listing; no_claim=a real older build (a store with its frozen header schema stands in)
test('a reader with the format 1 only header schema neither lists nor deletes a format 2 history', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const library = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [],
      output: ['a\n'],
      end: EXITED,
      library: {
        identity: LIBRARY_IDENTITY,
        prepared: PREPARED_FACTS,
        observed: OBSERVED_FACTS,
      },
    },
    repository,
  )
  const plain = await runScriptHistory(
    context,
    { declaredStops: 1, hits: [], output: ['b\n'], end: EXITED },
    repository,
  )
  const olderStore = new NodeHistoryStore(
    {
      ...nodeScriptStorageDescriptor,
      parseHeader: (value) => legacyNodeScriptHistoryHeaderSchema.parse(value),
    },
    learningDirectory,
    repository.scriptHistories.workspaceKey,
  )

  // Act
  const listed = (await olderStore.list()).map((summary) => summary.studyId)
  const header = await readStoredJson(
    learningDirectory,
    library.studyId,
    'header.json',
  )

  // Assert
  assert.throws(() => legacyNodeScriptHistoryHeaderSchema.parse(header))
  assert.deepEqual(listed, [plain.studyId])
  assert.equal(
    existsSync(
      join(learningDirectory, NODE_SCRIPT_HISTORY_DIRECTORY, library.studyId),
    ),
    true,
  )
})

/** Runs a library history with the given observation and returns the replay line the Script replay shows under its title. */
async function replayLineOf(
  context: Parameters<typeof runScriptHistory>[0],
  observed: NodeScriptLibraryObservedFacts,
  prepared = PREPARED_FACTS,
): Promise<string | undefined> {
  const { repository } = await openServerRepository(context)
  const { studyId } = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [],
      output: ['a\n'],
      end: EXITED,
      library: { identity: LIBRARY_IDENTITY, prepared, observed },
    },
    repository,
  )
  const history = await repository.scriptHistories.read(studyId)
  return describeLibraryCorrespondence(history.header, history.entries)
}

// protects=the correspondence line appears only for a loaded, completely observed library with no other copy, and names package, version, short revision and package manager; fails_when=the line is shown for any other observation, or drops a part; no_claim=the replay pane markup
test('the replay line states the checked-out library only for a loaded, complete observation with no other copy', async (context) => {
  // Arrange / Act
  const line = await replayLineOf(context, OBSERVED_FACTS)

  // Assert
  assert.equal(
    line,
    'Ran on the checked-out @reduxjs/toolkit 2.14.0 built from 7114787 (packed by pnpm)',
  )
})

// protects=uncommitted changes are disclosed on the correspondence line; fails_when=a dirty build reads as the clean revision; no_claim=which files differ
test('the replay line adds uncommitted changes for a dirty library', async (context) => {
  // Arrange / Act
  const line = await replayLineOf(context, OBSERVED_FACTS, {
    ...PREPARED_FACTS,
    dirty: true,
  })

  // Assert
  assert.equal(
    line,
    'Ran on the checked-out @reduxjs/toolkit 2.14.0 built from 7114787 (uncommitted changes) (packed by pnpm)',
  )
})

// protects=a built library the script never loaded reads as not loaded, never as the correspondence; fails_when=a not-loaded run claims the checked-out library; no_claim=why the script did not load it
test('the replay line says the library was built but not loaded when a complete observation saw no load', async (context) => {
  // Arrange / Act
  const line = await replayLineOf(context, {
    ...OBSERVED_FACTS,
    loaded: false,
    loadCount: 0,
  })

  // Assert
  assert.equal(
    line,
    'Built @reduxjs/toolkit 2.14.0, but not loaded by this script.',
  )
})

// protects=a second loaded copy of the package is named with its path and the run is not said to have run on the checked-out library alone; fails_when=the other copy is hidden behind the correspondence sentence; no_claim=which copy served which import
test('the replay line names the other copy the script also loaded', async (context) => {
  // Arrange / Act
  const line = await replayLineOf(context, {
    ...OBSERVED_FACTS,
    otherCopyLoaded: true,
    otherCopyPath: 'node_modules/@reduxjs/toolkit/dist/index.js',
  })

  // Assert
  assert.equal(
    line,
    'Built @reduxjs/toolkit 2.14.0 from 7114787, but the script also loaded another copy at node_modules/@reduxjs/toolkit/dist/index.js.',
  )
})

// protects=an incomplete or unreadable observation reads as not fully observed and never as not loaded or as the correspondence; fails_when=a truncated observation file produces a negative or a positive claim; no_claim=how the observation file is read
test('the replay line says what the script loaded was not fully observed for an incomplete observation', async (context) => {
  // Arrange / Act
  const incomplete = await replayLineOf(context, {
    ...OBSERVED_FACTS,
    loaded: false,
    loadCount: 0,
    observation: 'incomplete',
  })
  const unreadable = await replayLineOf(context, {
    ...OBSERVED_FACTS,
    observation: 'unreadable',
  })

  // Assert
  assert.equal(incomplete, 'What the script loaded was not fully observed.')
  assert.equal(unreadable, 'What the script loaded was not fully observed.')
})

// protects=the Script replay carries the line from the journal into its section under the title, the library entries are no steppable events, and a run without library has no line; fails_when=the section lacks the line, the library entries become timeline events, or a plain run shows a line; no_claim=the browser rendering of the line
test('the Script replay section carries the library line and keeps library entries out of its events', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const library = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [],
      output: ['a\n'],
      end: EXITED,
      library: {
        identity: LIBRARY_IDENTITY,
        prepared: PREPARED_FACTS,
        observed: OBSERVED_FACTS,
      },
    },
    repository,
  )
  const plain = await runScriptHistory(
    context,
    { declaredStops: 1, hits: [], output: ['b\n'], end: EXITED },
    repository,
  )

  // Act
  const libraryHistory = await repository.scriptHistories.read(library.studyId)
  const plainHistory = await repository.scriptHistories.read(plain.studyId)
  const replay = presentScriptHistory(libraryHistory, undefined)
  const libraryModel = replay.shownModel
  const plainModel = presentScriptHistory(plainHistory, undefined).shownModel
  const section = projectServerSection({
    replay,
    selectedStopVerified: false,
    applicationClosed: false,
  })

  // Assert
  assert.deepEqual(
    libraryModel.events.map((event) => event.type),
    ['output', 'end'],
  )
  assert.equal(
    libraryModel.libraryLine,
    'Ran on the checked-out @reduxjs/toolkit 2.14.0 built from 7114787 (packed by pnpm)',
  )
  assert.equal(section.libraryLine, libraryModel.libraryLine)
  assert.equal(plainModel.libraryLine, undefined)
})

// protects=a script that loaded only another copy of the package reads as having loaded that copy, not as "not loaded"; fails_when=a complete observation with loaded false and another copy hides the copy behind the not-loaded sentence; no_claim=which import resolved to which copy
test('the replay line names the other copy when the script loaded only that copy and not the built one', async (context) => {
  // Arrange / Act
  const line = await replayLineOf(context, {
    ...OBSERVED_FACTS,
    loaded: false,
    loadCount: 0,
    otherCopyLoaded: true,
    otherCopyPath: 'node_modules/@reduxjs/toolkit/dist/index.js',
  })

  // Assert
  assert.equal(
    line,
    'Built @reduxjs/toolkit 2.14.0 from 7114787, but the script did not load it; it loaded another copy at node_modules/@reduxjs/toolkit/dist/index.js.',
  )
})

// protects=a header input whose library key is present but undefined stays format 1, which older versions read; fails_when=the key's presence alone stamps format 2; no_claim=how callers build the input
test('a header input with an undefined library is stamped format 1', () => {
  // Arrange
  const input = { ...headerFor('workspace-key', false), library: undefined }

  // Act
  const stamped = nodeScriptStorageDescriptor.stampHeader(input)

  // Assert
  assert.equal((stamped as { formatVersion: number }).formatVersion, 1)
})

// protects=library.prepared texts are hidden of private roots and cut to their schema bounds, so one long value never fails the history; fails_when=a long package, version or revision leaves the history unverified, or a private root survives in packageRoot or installedVersion; no_claim=the real build facts
test('library.prepared hides private roots and cuts long texts so the history stays verified', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)

  // Act
  const { studyId } = await runScriptHistory(
    context,
    {
      declaredStops: 1,
      hits: [],
      output: ['a\n'],
      end: EXITED,
      hideRoots: (text) => text.replaceAll('/private/root', '<root>'),
      library: {
        identity: LIBRARY_IDENTITY,
        prepared: {
          ...PREPARED_FACTS,
          package: 'p'.repeat(300),
          version: 'v'.repeat(300),
          revision: 'r'.repeat(1_500),
          packageRoot: '/private/root/packages/toolkit',
          installedVersion: '/private/root/node_modules/x',
        },
        observed: OBSERVED_FACTS,
      },
    },
    repository,
  )
  const prepared = (await readJournal(learningDirectory, studyId)).find(
    (entry) => entry.type === 'library.prepared',
  ) as Record<string, string> | undefined
  const { scripts } = await repository.listByProfile()

  // Assert
  assert.equal(scripts[0]!.verification, 'verified')
  assert.equal(prepared?.package?.length, 214)
  assert.equal(prepared?.version?.length, 256)
  assert.equal(prepared?.revision?.length, 1_024)
  assert.equal(prepared?.packageRoot, '<root>/packages/toolkit')
  assert.equal(prepared?.installedVersion, '<root>/node_modules/x')
})

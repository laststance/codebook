import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { LearningLibrary } from '../learningLibrary'
import type { RecordingIndex } from '../recordingSchemas'
import { crossRuntimeRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { legacyStudyFormatOfConfiguration } from '../utils/legacyStudyFormatOfConfiguration'
import { newerStudyArchive } from '../utils/newerStudyArchive'
import { projectRecording } from '../utils/projectRecording'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

const VITE_RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/**
 * Re-seals the Next browser fixture as a study made with the `vite-dev` adapter: format 5, the hash of the changed configuration and a run id of its own.
 * @returns A decodable study whose configuration names `vite-dev`.
 * @example
 * viteStudy().version // => 5
 */
function viteStudy(): ConfiguredStudy {
  const study = createConfiguredStudy()
  const configuration = { ...study.configuration, adapter: 'vite-dev' as const }
  return {
    ...study,
    version: 5,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    runId: VITE_RUN_ID,
    id: `${study.instanceId}_${VITE_RUN_ID}`,
    observations: study.observations.map((observation) => ({
      ...observation,
      snapshotUri: observation.snapshotUri.replace(study.runId, VITE_RUN_ID),
    })),
  }
}

/**
 * Re-seals the cross-runtime fixture as a version 2 `vite-dev` study with browser participants only (the server stop is dropped, as `vite-dev` refuses it): format 5, the hash of the changed configuration and a run id of its own.
 * @returns A decodable cross-runtime study whose configuration names `vite-dev`.
 * @example
 * viteCrossRuntimeStudy().configuration.version // => 2
 */
function viteCrossRuntimeStudy(): ConfiguredStudy {
  const study = createCrossRuntimeStudy()
  const [browser, , finalBrowser] = study.observations
  const configuration = crossRuntimeRepositoryConfigSchema.parse({
    ...study.configuration,
    adapter: 'vite-dev',
    additionalStops: study.configuration.additionalStops?.slice(1),
  })
  const observations = [browser!, finalBrowser!].map((observation) => ({
    ...observation,
    snapshotUri: observation.snapshotUri.replace(study.runId, VITE_RUN_ID),
  }))
  const pausedIds = new Set(observations.map((observation) => observation.id))
  return {
    ...study,
    version: 5,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    runId: VITE_RUN_ID,
    id: `${study.instanceId}_${VITE_RUN_ID}`,
    observations,
    captures: study.captures.filter(
      (capture) => !capture.snapshotId || pausedIds.has(capture.snapshotId),
    ),
  }
}

/**
 * Reads the format number written inside a saved archive file.
 * @param path - Absolute path of a `.study.v<n>.json` file.
 * @returns The `version` field of the archive.
 * @example
 * await savedVersion('/tmp/x/<id>.study.v5.json') // => 5
 */
async function savedVersion(path: string): Promise<number> {
  const archive: { version: number } = JSON.parse(await readFile(path, 'utf8'))
  return archive.version
}

test('an archive saved before format 6 for a vite-dev configuration of version 2 is format 5, not the Next cross-runtime format 4', () => {
  // Arrange
  const configuration = viteCrossRuntimeStudy().configuration
  // Act
  const format = legacyStudyFormatOfConfiguration(configuration)
  // Assert
  assert.equal(configuration.version, 2)
  assert.equal(format, 5)
})

test('a format-5 cross-runtime vite-dev study decodes and its recording context builds and validates as the cross-runtime recording version', () => {
  // Arrange
  const study = viteCrossRuntimeStudy()
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  const context = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    study.workspaceKey,
  )
  // Assert
  assert.equal(decoded.version, 5)
  assert.equal(context.version, 3)
})

test('a demonstrated format-5 cross-runtime vite-dev study without debugger state is still refused as incomplete cross-runtime history', () => {
  // Arrange
  const study = viteCrossRuntimeStudy()
  const withoutDebugger = {
    ...study,
    observations: study.observations.map(
      ({ debugger: _debugger, ...observation }) => observation,
    ),
  }
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy(withoutDebugger, study.workspaceKey),
    { message: 'Completed cross-runtime history lacks native debugger state.' },
  )
})

test('an archive saved before format 6 holds format 3 for a Next configuration of version 1, 4 for version 2 and 5 for a vite-dev configuration', () => {
  // Arrange
  const nextBrowser = createConfiguredStudy().configuration
  const nextCrossRuntime = createCrossRuntimeStudy().configuration
  const vite = viteStudy().configuration
  // Act
  const formats = [nextBrowser, nextCrossRuntime, vite].map(
    legacyStudyFormatOfConfiguration,
  )
  // Assert
  assert.deepEqual(formats, [3, 4, 5])
})

test('a Next browser, a Next cross-runtime and a vite-dev study sealed as format 6 decode', () => {
  // Arrange
  const studies = [
    { ...createConfiguredStudy(), version: 6 as const },
    { ...createCrossRuntimeStudy(), version: 6 as const },
    { ...viteStudy(), version: 6 as const },
  ]
  // Act
  const versions = studies.map(
    (study) => decodeConfiguredStudy(study, study.workspaceKey).version,
  )
  // Assert
  assert.deepEqual(versions, [6, 6, 6])
})

test('a study of format 6 is saved as .study.v6.json and an earlier Codebook that reads up to 5 judges it newer by name and number', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-v6-study-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = { ...createConfiguredStudy(), version: 6 as const }
  const library = new LearningLibrary(directory, study.workspaceKey)
  const previousReadableVersion = 5
  // Act
  await library.saveStudy(study)
  const archive = join(directory, `${study.id}.study.v6.json`)
  const reopened = await library.readStudy(study.id)
  // Assert
  assert.equal(await savedVersion(archive), 6)
  assert.equal(reopened.version, 6)
  assert.equal((await savedVersion(archive)) > previousReadableVersion, true)
  assert.equal(newerStudyArchive(`${study.id}.study.v7.json`)?.version, 7)
  assert.equal(newerStudyArchive(`${study.id}.study.v6.json`), undefined)
})

test('a vite-dev study of format 5 decodes in this version and a Next browser study sealed as format 5 is refused', () => {
  // Arrange
  const vite = viteStudy()
  const nextSealedAsVite = { ...createConfiguredStudy(), version: 5 }
  // Act
  const decoded = decodeConfiguredStudy(vite, vite.workspaceKey)
  // Assert
  assert.equal(decoded.version, 5)
  assert.throws(
    () =>
      decodeConfiguredStudy(nextSealedAsVite, nextSealedAsVite.workspaceKey),
    { message: 'Configured archive and intent versions disagree.' },
  )
})

test('a vite-dev study is saved as .study.v5.json, reopens and seeks to its browser stop', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vite-study-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = viteStudy()
  const library = new LearningLibrary(directory, study.workspaceKey)
  const index: RecordingIndex = {
    header: {
      version: 2,
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: study.runId,
      profile: study.profile,
      sourceBuild: {
        revision: 'test',
        dirty: false,
        sourceHash: sha256('test source'),
      },
      createdAt: study.createdAt,
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: { pid: 1, hostname: 'test', sessionId: study.instanceId },
    },
    entries: [],
    status: 'finalized',
    endMs: 4000,
    lastVerifiedMs: 4000,
  }
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const recordingContext = validateRecordingContext(
    buildRecordingContext(reopened, [], 1),
    study.workspaceKey,
  )
  const projection = projectRecording(index, recordingContext, 2000)
  // Assert
  assert.equal(
    await savedVersion(join(directory, `${study.id}.study.v5.json`)),
    5,
  )
  assert.equal(reopened.version, 5)
  assert.equal(recordingContext.version, 2)
  assert.equal(projection.observation?.participant, 'browser')
  assert.equal(projection.observation?.values['value:nextTheme'], 'dark')
})

test('a library holding Next format 3, Next format 4 and vite-dev format 5 studies lists all three, each file named and numbered by its format', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vite-library-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const nextBrowser = createConfiguredStudy()
  const nextCrossRuntime = createCrossRuntimeStudy()
  nextCrossRuntime.runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  nextCrossRuntime.id = `${nextCrossRuntime.instanceId}_${nextCrossRuntime.runId}`
  for (const observation of nextCrossRuntime.observations)
    observation.snapshotUri = `codebook://${nextCrossRuntime.instanceId}/runs/${nextCrossRuntime.runId}/snapshots/${encodeURIComponent(observation.id)}`
  const vite = viteStudy()
  const library = new LearningLibrary(directory, nextBrowser.workspaceKey)
  // Act
  await library.saveStudy(nextBrowser)
  await library.saveStudy(nextCrossRuntime)
  await library.saveStudy(vite)
  const listed = await library.list()
  // Assert
  assert.deepEqual(listed.map((entry) => entry.format).sort(), [
    'v3',
    'v4',
    'v5',
  ])
  // An older Codebook (reads up to 4) judges a file by this name and number alone, so format 5 must show both.
  assert.equal(
    await savedVersion(join(directory, `${nextBrowser.id}.study.v3.json`)),
    3,
  )
  assert.equal(
    await savedVersion(join(directory, `${nextCrossRuntime.id}.study.v4.json`)),
    4,
  )
  assert.equal(
    await savedVersion(join(directory, `${vite.id}.study.v5.json`)),
    5,
  )
})

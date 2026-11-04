import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { studyFormatOfConfiguration } from '../utils/studyFormatOfConfiguration'

import { replaySavedServerStop } from './utils/replaySavedServerStop'

const FIXTURES = resolve(__dirname, '../../src/tests/fixtures')
const LIBRARY_STUDY_PATH = join(
  FIXTURES,
  'vite-library-study-v0.2.78.0/browser-library-stop.study.v10.json',
)
const ROOT_GOLDEN_PATH = join(
  FIXTURES,
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/** Reads the fixture study: a format 10 study of a nested Vite app whose browser stop lies in `packages/core/src/a.ts`. */
async function readLibraryStudy(): Promise<ConfiguredStudy> {
  return JSON.parse(await readFile(LIBRARY_STUDY_PATH, 'utf8'))
}

// protects=AC 5 compatibility: a format 10 study with a library stop (a stop file outside the app folder) decodes with the current format 10 decoder, keeps the library file's repository-relative path, hash and line, and has no top-level field the 0.2.72.0 golden lacks and no configuration field beyond packageRoot; fails_when=the decoder rejects a stop outside packageRoot, the path is rewritten, or the study gained a field; no_claim=a study written by a live run (the fixture is the 0.2.72.0 golden resealed for the library path with a recorded frame; the schemas are unchanged in this cycle's diff)
test('a format 10 study with a library stop decodes with the format 10 decoder and carries no new field', async () => {
  // Arrange
  const raw = await readLibraryStudy()
  const golden = JSON.parse(await readFile(ROOT_GOLDEN_PATH, 'utf8'))
  // Act
  const decoded = decodeConfiguredStudy(raw, raw.workspaceKey)
  // Assert
  assert.equal(decoded.version, 10)
  assert.equal(studyFormatOfConfiguration(decoded.configuration), 10)
  assert.equal(decoded.configuration.source.path, 'packages/core/src/a.ts')
  assert.equal(
    'packageRoot' in decoded.configuration && decoded.configuration.packageRoot,
    'examples/react/basic',
  )
  assert.equal(
    decoded.observations[0]?.source.hash,
    decoded.descriptor?.sources[0]?.hash,
  )
  assert.deepEqual(Object.keys(raw).sort(), Object.keys(golden).sort())
  assert.deepEqual(
    Object.keys(raw.configuration).sort(),
    [...Object.keys(golden.configuration), 'packageRoot'].sort(),
  )
})

// protects=AC 5 replay: the replay shows the recorded library line and values with no library folder on disk, also after the library's build/ folder is deleted; fails_when=the replay reads the library's build or source from disk or loses the recorded frame, line or value; no_claim=the editor's native debugger (the replay debug adapter is driven directly)
test('a library stop replays its recorded source line and values after the library build folder is deleted', async (context) => {
  // Arrange
  const repository = await mkdtemp(join(tmpdir(), 'codebook-vite-library-'))
  context.after(() => rm(repository, { recursive: true, force: true }))
  const build = join(repository, 'packages/core/build/modern')
  await mkdir(build, { recursive: true })
  await writeFile(join(build, 'a.js'), 'built()')
  const study = await readLibraryStudy()
  const replayedBefore = await replaySavedServerStop(context, study, 'browser')
  await rm(join(repository, 'packages/core/build'), { recursive: true })
  // Act
  const replayedAfter = await replaySavedServerStop(context, study, 'browser')
  // Assert
  assert.equal(replayedAfter.study.version, 10)
  assert.equal(replayedAfter.topFrameName, 'fetch')
  assert.equal(replayedAfter.topFrameLine, 1)
  assert.deepEqual(replayedAfter.variables, [
    { name: 'fetchCount', value: '3' },
  ])
  assert.equal(
    replayedAfter.shownSourceHash,
    study.observations[0]?.source.hash,
  )
  assert.deepEqual(replayedAfter.variables, replayedBefore.variables)
})

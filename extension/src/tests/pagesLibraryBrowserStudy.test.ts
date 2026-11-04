import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { studyFormatOfConfiguration } from '../utils/studyFormatOfConfiguration'

import { replaySavedServerStop } from './utils/replaySavedServerStop'

const FIXTURES = resolve(__dirname, '../../src/tests/fixtures')
const LIBRARY_STUDY_PATH = join(
  FIXTURES,
  'pages-library-browser-study-v0.2.80.0/browser-library-stop.study.v9.json',
)
const ROOT_GOLDEN_PATH = join(
  FIXTURES,
  'operations-study-v0.2.72.0/browser-only-v3.study.v7.json',
)

/** Reads the fixture study: a format 9 study of a nested Next Pages app whose browser stop lies in `packages/lib/src/core.ts`, generated from the lane A browser library run. */
async function readLibraryStudy(): Promise<ConfiguredStudy> {
  return JSON.parse(await readFile(LIBRARY_STUDY_PATH, 'utf8'))
}

// protects=AC 5 compatibility: a format 9 study with a browser library stop (a stop file outside the app folder) decodes with the current decoder, keeps the library file's repository-relative path, hash, translated line and recorded value, and has no top-level field the 0.2.72.0 golden lacks and no configuration field beyond those format 9 allows (additionalStops, packageRoot); fails_when=the decoder rejects a stop outside packageRoot, the path, hash or line is rewritten, or the study gained a field; no_claim=a study written by a live Next run (the fixture comes from the scripted browser library run saved through the service writer; the schemas are unchanged in this cycle's diff)
test('a format 9 study with a browser library stop decodes with the format 9 decoder and carries no new field', async () => {
  // Arrange
  const raw = await readLibraryStudy()
  const golden = JSON.parse(await readFile(ROOT_GOLDEN_PATH, 'utf8'))
  // Act
  const decoded = decodeConfiguredStudy(raw, raw.workspaceKey)
  // Assert
  assert.equal(decoded.version, 9)
  assert.equal(studyFormatOfConfiguration(decoded.configuration), 9)
  assert.equal(decoded.configuration.source.path, 'packages/lib/src/core.ts')
  assert.equal(
    decoded.configuration.source.hash,
    'a8106b1601e84d7525e84ed95ade45c3d88e68bd54af34a5103beef8c3063858',
  )
  assert.equal(decoded.observations[0]?.source.line, 3)
  assert.equal(
    decoded.observations[0]?.source.hash,
    decoded.descriptor?.sources[0]?.hash,
  )
  assert.deepEqual(decoded.observations[0]?.values, { 'value:doubled': 6 })
  assert.deepEqual(Object.keys(raw).sort(), Object.keys(golden).sort())
  assert.deepEqual(
    Object.keys(raw.configuration).sort(),
    [
      ...Object.keys(golden.configuration),
      'additionalStops',
      'packageRoot',
    ].sort(),
  )
})

// protects=AC 5 replay: the replay of a saved browser library stop shows the recorded library source line, frame and doubled = 6 from the saved study alone, and the source it shows is the text the study recorded; fails_when=the replay loses the recorded frame, line, value or source text, or shows a source other than the recorded one; no_claim=that the debugger variable list holds doubled (the scripted browser frame lists only nextTheme; doubled = 6 is asserted on the reopened observation), that the replay never reads the repository (replaySavedServerStop saves the study in its own temp folder and takes no repository path), and the editor's native debugger (the replay debug adapter is driven directly)
test('a browser library stop replays its recorded source line and doubled = 6 from the saved study alone', async (context) => {
  // Arrange
  const study = await readLibraryStudy()
  // Act
  const replayed = await replaySavedServerStop(context, study, 'browser')
  // Assert
  assert.equal(replayed.study.version, 9)
  assert.equal(replayed.topFrameName, 'configured')
  assert.equal(replayed.topFrameLine, 3)
  // The scripted browser frame always lists nextTheme; the doubled value rides in the observation the replay reopened.
  assert.deepEqual(replayed.variables, [{ name: 'nextTheme', value: 'dark' }])
  assert.deepEqual(replayed.study.observations[0]?.values, {
    'value:doubled': 6,
  })
  assert.equal(
    replayed.shownSourceText,
    'export function double(count: number): number {\n  const doubled = count * 2\n  return doubled\n}\n',
  )
  assert.equal(replayed.shownSourceHash, study.observations[0]?.source.hash)
})

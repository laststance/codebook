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

// protects=AC 5 compatibility: a format 10 study with a library stop (a stop file outside the app folder) decodes with the current format 10 decoder, keeps the library file's repository-relative path, hash and line, and has no top-level field the 0.2.72.0 golden lacks and no configuration field beyond packageRoot; fails_when=the decoder rejects a stop outside packageRoot, the path is rewritten, or the study gained a field; no_claim=a study written by a live run (the fixture is a Vite library stop whose observation records the served module's script URL, frame and variables, generated with the codebase's own hash helpers and accepted by the decoder; the schemas are unchanged in this cycle's diff)
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
  assert.match(
    decoded.observations[0]?.source.scriptUrl ?? '',
    /^http:\/\/127\.0\.0\.1:\d+\/@fs\/.+\/packages\/core\/build\/modern\/a\.js$/,
  )
  assert.deepEqual(Object.keys(raw).sort(), Object.keys(golden).sort())
  assert.deepEqual(
    Object.keys(raw.configuration).sort(),
    [...Object.keys(golden.configuration), 'packageRoot'].sort(),
  )
})

// protects=AC 5 replay: the replay of a saved library stop shows the recorded library line, frame and values from the saved study alone, and the source it shows is the text the study recorded; fails_when=the replay loses the recorded frame, line, value or source text, or shows a source other than the recorded one; no_claim=that the replay never reads the repository (replaySavedServerStop saves the study in its own temp folder and takes no repository path, so this test names no repository folder and deletes none), and the editor's native debugger (the replay debug adapter is driven directly)
test('a library stop replays its recorded source line and values from the saved study alone', async (context) => {
  // Arrange
  const study = await readLibraryStudy()
  // Act
  const replayed = await replaySavedServerStop(context, study, 'browser')
  // Assert
  assert.equal(replayed.study.version, 10)
  assert.equal(replayed.topFrameName, '(anonymous)')
  assert.equal(replayed.topFrameLine, 1)
  assert.deepEqual(replayed.variables, [{ name: 'nextTheme', value: '"dark"' }])
  assert.equal(replayed.shownSourceText, 'const nextTheme = "dark";\n')
  assert.equal(replayed.shownSourceHash, study.observations[0]?.source.hash)
})

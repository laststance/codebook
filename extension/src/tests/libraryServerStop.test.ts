import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
} from './utils/libraryBuildHarness'
import { captureLibraryRun } from './utils/libraryServerRunHarness'
import { replaySavedServerStop } from './utils/replaySavedServerStop'

// protects=AC 1 a server stop on `return doubled` in a workspace library the nested Pages app links pauses with doubled = 6, records the library source (path, text, hash, line) as the top frame and the observation, saves as format 9 and replays with that source and value; fails_when=the stop is refused outside-package, the record keeps the built file's text or line, or the saved study fails validation; no_claim=a real Next compile or js-debug (the server compile and the debugger are scripted; the maps are real TypeScript output)
test('a server stop in a linked workspace library pauses, saves in format 9 and replays with the library source and doubled = 6', async (context) => {
  // Arrange
  const { study, run } = await captureLibraryRun(context)
  // Act
  const replayed = await replaySavedServerStop(context, study)
  // Assert
  const recorded = replayed.study.observations[0]!
  assert.equal(replayed.study.version, 9)
  assert.equal(recorded.source.line, LIBRARY_RETURN_LINE)
  assert.equal(recorded.source.hash, sha256(LIBRARY_SOURCE))
  assert.equal(recorded.source.text, LIBRARY_SOURCE)
  assert.equal(recorded.debugger?.frames[0]?.source?.name, LIBRARY_SOURCE_PATH)
  assert.equal(recorded.debugger?.frames[0]?.line, LIBRARY_RETURN_LINE)
  assert.deepEqual(recorded.values, { 'value:doubled': 6 })
  assert.equal(replayed.topFrameLine, LIBRARY_RETURN_LINE)
  assert.deepEqual(replayed.variables, [{ name: 'doubled', value: '6' }])
  assert.equal(replayed.shownSourceHash, sha256(LIBRARY_SOURCE))
  assert.equal(run.harness.developmentServerLaunches() > 0, true)
})

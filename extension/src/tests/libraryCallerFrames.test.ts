import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LIBRARY_SOURCE_PATH } from './utils/libraryBuildHarness'
import { captureLibraryRun } from './utils/libraryServerRunHarness'

// protects=A6: in a library stop's saved call stack a caller frame in the stop's built file is recorded at the library source path and line (source line 2, `const doubled`), while a frame of the app's page module keeps its own path and line; fails_when=translateLibraryFrame returns undefined for a covered caller frame (the caller keeps the built file's line and no library path) or translates a frame of another file; no_claim=a real js-debug stack (the adapter is scripted to report these two callers)
test('a library stop records its same-file caller frame at the library source and keeps an app frame as reported', async (context) => {
  // Arrange: built line 2 of the modern build holds library source line 2 (`const doubled = …`), a line the frozen map covers.
  const callerBuiltLine = 2
  const pagePath = '/repo/examples/app/pages/index.js'
  // Act
  const { study, staged } = await captureLibraryRun(
    context,
    {},
    {
      callers: [
        { name: 'caller', line: callerBuiltLine, column: 5 },
        { name: 'getServerSideProps', path: pagePath, line: 40, column: 7 },
      ],
    },
  )
  // Assert
  assert.equal(staged.files().builtLineOf(2), callerBuiltLine)
  const frames = study.observations[0]!.debugger!.frames
  assert.equal(frames.length, 3)
  assert.equal(frames[1]!.name, 'caller')
  assert.equal(frames[1]!.line, 2)
  assert.equal(frames[1]!.recordedLocation?.path, LIBRARY_SOURCE_PATH)
  assert.equal(frames[2]!.name, 'getServerSideProps')
  assert.equal(frames[2]!.line, 40)
  assert.equal(frames[2]!.column, 7)
  // The page module lies outside the workspace root, so only its file name is kept, as reported.
  assert.equal(frames[2]!.recordedLocation?.name, 'index.js')
  assert.equal(frames[2]!.recordedLocation?.path, undefined)
})

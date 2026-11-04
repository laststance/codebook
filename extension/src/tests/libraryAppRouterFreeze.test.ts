import assert from 'node:assert/strict'
import { test } from 'node:test'

import { libraryPlaceAmbiguousRefusal } from '../nextRefusals'
import {
  appLibraryPathConflictOf,
  libraryMapOverrides,
} from '../utils/libraryMapOverrides'

const FIRST = {
  appResolvedPaths: ['/repo/src/core.ts'],
  checkedOutFile: '/repo/packages/a/src/core.ts',
}

// protects=AC 3 (Cycle 0080 review) two frozen browser stops whose app-resolved path is equal but whose checked-out files differ are a conflict naming the path and the file that already holds it, so the freeze can refuse before any process starts; fails_when=the later stop silently takes the key, or the conflict names no file; no_claim=the wiring in ConfiguredBrowserRun.freezeLibraryStop (the run harness cannot stage two libraries behind one path) and a real Next compile
test('two frozen browser stops that share an app-resolved path but not a file are a collision', () => {
  // Arrange
  const second = {
    appResolvedPaths: ['/repo/src/core.ts'],
    checkedOutFile: '/repo/packages/b/src/core.ts',
  }
  // Act
  const conflict = appLibraryPathConflictOf([FIRST], second)
  // Assert
  assert.deepEqual(conflict, {
    kind: 'collision',
    path: '/repo/src/core.ts',
    otherFile: '/repo/packages/a/src/core.ts',
  })
})

// protects=AC 3 (Cycle 0080 review) a second stop in the same checked-out file shares its keys without a conflict; fails_when=two stops of one library file are refused; no_claim=different lines of one file (the freeze key is the declared place)
test('two frozen browser stops in the same checked-out file are no conflict', () => {
  // Arrange
  const sameFile = { ...FIRST }
  // Act
  const conflict = appLibraryPathConflictOf([FIRST], sameFile)
  // Assert
  assert.equal(conflict, undefined)
})

// protects=AC 3 (Cycle 0080 review) an app-resolved path with `*` is a wildcard conflict that names the path, instead of being dropped so that the breakpoint never binds; fails_when=a path with a star is accepted or left out silently; no_claim=js-debug's own reading of the key
test('an app-resolved path with a star is a wildcard conflict naming the path', () => {
  // Arrange
  const starred = {
    appResolvedPaths: ['/repo/src/*.ts'],
    checkedOutFile: '/repo/packages/a/src/core.ts',
  }
  // Act
  const conflict = appLibraryPathConflictOf([], starred)
  // Assert
  assert.deepEqual(conflict, { kind: 'wildcard', path: '/repo/src/*.ts' })
})

// protects=AC 3 (Cycle 0080 review) distinct paths of different files make no conflict and keep one exact override each; fails_when=unrelated stops are refused or an override is lost; no_claim=the browser launch
test('two stops with distinct app-resolved paths keep one exact override each', () => {
  // Arrange
  const second = {
    appResolvedPaths: ['/repo/src/other.ts'],
    checkedOutFile: '/repo/packages/b/src/other.ts',
  }
  // Act
  const conflict = appLibraryPathConflictOf([FIRST], second)
  const overrides = libraryMapOverrides([FIRST, second])
  // Assert
  assert.equal(conflict, undefined)
  assert.deepEqual(overrides, {
    '/repo/src/core.ts': '/repo/packages/a/src/core.ts',
    '/repo/src/other.ts': '/repo/packages/b/src/other.ts',
  })
})

// protects=AC 3 (Cycle 0080 review) the freeze refusal is NEXT_STOP_NOT_SEALED library-place-ambiguous with router app and sideEffects none, since no process has started; fails_when=the refusal reports sideEffects unknown or the Pages router; no_claim=the message wording beyond the named character
test('the freeze-time place refusal reports router app and no side effects', () => {
  // Arrange
  const why = 'the path /repo/src/*.ts holds the character *'
  // Act
  const error = libraryPlaceAmbiguousRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    3,
    why,
    'app',
    'none',
  )
  // Assert
  assert.equal(Reflect.get(error, 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(JSON.parse(JSON.stringify(Reflect.get(error, 'details'))), {
    reason: 'library-place-ambiguous',
    packageRoot: 'examples/app',
    library: 'lib',
    file: 'packages/lib/src/core.ts',
    router: 'app',
    sideEffects: 'none',
  })
  assert.match(error.message, /holds the character \*/)
})

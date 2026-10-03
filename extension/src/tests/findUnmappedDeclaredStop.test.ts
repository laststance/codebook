import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findUnmappedDeclaredStop } from '../utils/findUnmappedDeclaredStop'

/** Builds a prepared stop of a module whose sealed map has positions on the given lines, counting every scan of that map. @example sealedModule('a'.repeat(64), [1, 4]).verifier */
function sealedModule(sourceMapHash: string, mappedLines: number[]) {
  const scans: { startLine: number; endLine: number }[] = []
  return {
    scans,
    verifier: {
      hashes: { sourceMap: sourceMapHash },
      mappedPositions(startLine: number, endLine: number) {
        scans.push({ startLine, endLine })
        return {
          positions: mappedLines
            .filter((line) => line >= startLine && line <= endLine)
            .map((line) => ({ line, column: 1 })),
          complete: true,
        }
      },
    },
  }
}

// Value: protects=preparation cost for several stops in one module; fails_when=the sealed map is scanned once per declared stop instead of once per module; why_new=Cycle 0036 C08e; seam=the map reader counts its scans
test('three declared stops in one sealed module scan its map once over the lines they declare', () => {
  // Arrange
  const themeModule = sealedModule('a'.repeat(64), [2, 5, 9])
  const stops = [9, 2, 5].map((line) => ({
    source: { path: 'src/theme.ts', line },
    verifier: themeModule.verifier,
  }))

  // Act
  const unmapped = findUnmappedDeclaredStop(stops)

  // Assert
  assert.equal(unmapped, undefined)
  assert.deepEqual(themeModule.scans, [{ startLine: 2, endLine: 9 }])
})

// Value: protects=the refusal of a stop whose line holds no code before any application effect; fails_when=the shared scan loses which stop is unmapped, or names a later stop first; why_new=Cycle 0036 C08e moved the per-stop check into one scan per module; seam=none
test('the first declared stop on a line without a mapped position is found, also when another module is fully mapped', () => {
  // Arrange
  const themeModule = sealedModule('a'.repeat(64), [1, 4]),
    modeModule = sealedModule('b'.repeat(64), [7])
  const mappedThemeStop = {
      source: { path: 'src/theme.ts', line: 4 },
      verifier: themeModule.verifier,
    },
    modeStop = {
      source: { path: 'src/mode.ts', line: 7 },
      verifier: modeModule.verifier,
    },
    blankThemeStop = {
      source: { path: 'src/theme.ts', line: 3 },
      verifier: themeModule.verifier,
    }

  // Act
  const unmapped = findUnmappedDeclaredStop([
    mappedThemeStop,
    modeStop,
    blankThemeStop,
  ])

  // Assert
  assert.equal(unmapped, blankThemeStop)
  assert.deepEqual(themeModule.scans, [{ startLine: 3, endLine: 4 }])
  assert.deepEqual(modeModule.scans, [{ startLine: 7, endLine: 7 }])
})

// Value: protects=a stop in a module whose map scan stopped at its size limit; fails_when=a partial scan is read as proof that the line is unmapped and the run is refused before arming could bind it; why_new=Cycle 0036 C08e keeps the partial-scan rule in the shared scan; seam=none
test('a module whose map scan stopped at its size limit refuses no stop at preparation', () => {
  // Arrange
  const partialStop = {
    source: { path: 'src/theme.ts', line: 3 },
    verifier: {
      hashes: { sourceMap: 'c'.repeat(64) },
      mappedPositions: () => ({ positions: [], complete: false }),
    },
  }

  // Act
  const unmapped = findUnmappedDeclaredStop([partialStop])

  // Assert
  assert.equal(unmapped, undefined)
})

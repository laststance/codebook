import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

/** The bidirectional controls that can reorder what a reader of the source sees (Trojan Source); written here as escapes, as the guarded files must write them. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/

/**
 * Lists every file under a folder, its subfolders included.
 * @param folder - The folder to read.
 * @returns The files' absolute paths.
 * @example filesUnder('/repo/extension/src') // => ['/repo/extension/src/extension.ts', …]
 */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(folder, entry.name))
      : [join(folder, entry.name)],
  )
}

// Value: protects=a reviewer of the extension's source, scripts and bundled skill sees every bidirectional control as an escape, so no invisible character reorders code or text in an editor or a diff; fails_when=a raw U+202E or another bidirectional control is written into a source, script or skill file (as F322 found in a regular expression and two docstrings); why_new=F322 (PR-2 /ship Step 9 pass 2 maintainability): the controls' own guard was written with the raw characters; seam=none; no_claim=generated files, dependencies and the built output
test('the extension’s source, scripts and skill write every bidirectional control as an escape, never raw', () => {
  // Arrange
  const extensionRoot = resolve(__dirname, '../..')
  const files = ['src', 'scripts', 'skills']
    .flatMap((folder) => filesUnder(join(extensionRoot, folder)))
    .filter((file) => /\.(?:ts|mjs|js|md)$/.test(file))

  // Act
  const withRawControls = files
    .filter((file) => BIDI_CONTROLS.test(readFileSync(file, 'utf8')))
    .map((file) => relative(extensionRoot, file))

  // Assert: the scan reads the tree, and no file holds a raw control.
  assert.ok(files.length > 100, `only ${files.length} files were scanned`)
  assert.deepEqual(withRawControls, [])
})

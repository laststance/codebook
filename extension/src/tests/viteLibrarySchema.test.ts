import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import {
  liveRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
} from '../repositoryConfigSchemas'
import { assertViteLibraryNeedsPackageRoot } from '../utils/assertViteLibraryNeedsPackageRoot'
import { VITE_LIBRARY_CONFIGURATION } from '../viteHelp'

/** A fresh copy of the help's library sample, so a test can change one field. */
function sample(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VITE_LIBRARY_CONFIGURATION))
}

// protects=a nested version 3 vite-dev configuration may declare library.packageRoot and keeps it; fails_when=the field is stripped, refused or reshaped; no_claim=that the library exists (the build checks)
test('accepts library on a nested version 3 vite-dev configuration', () => {
  // Arrange
  const configuration = sample()
  // Act
  const parsed = liveRepositoryConfigSchema.parse(configuration)
  // Assert
  assert.deepEqual('library' in parsed ? parsed.library : undefined, {
    packageRoot: 'packages/widgets',
  })
})

// protects=versions 1 and 2 and every other adapter keep refusing library exactly as an unknown key; fails_when=library is accepted outside a version 3 vite-dev configuration or refused with another message; no_claim=none beyond protects
test('refuses library as an unknown key on versions 1 and 2 and on other adapters', () => {
  // Arrange
  const versionOne = {
    version: 1,
    adapter: 'vite-dev',
    book: { bookId: 'a', revision: 1, nodeId: 'n', anchorIndex: 0 },
    source: {
      path: 'src/a.ts',
      hash: '0'.repeat(64),
      line: 1,
      column: 1,
    },
    action: {
      title: 'Click',
      selector: '#a',
      before: [{ kind: 'visible', selector: '#a' }],
      after: [{ kind: 'text', selector: '#b', equals: 'x' }],
    },
    inspections: [{ path: 'value', mode: 'value', required: true }],
    library: { packageRoot: 'packages/widgets' },
  }
  const nextAdapter = { ...sample(), adapter: 'next-dev-webpack' }
  const reactScripts = { ...sample(), adapter: 'react-scripts-dev' }
  // Act
  const results = [versionOne, nextAdapter, reactScripts].map((candidate) =>
    liveRepositoryConfigSchema.safeParse(candidate),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false, false],
  )
  for (const result of results.slice(1))
    assert.match(
      result.error?.message ?? '',
      /"message": "Unrecognized key: \\"library\\""/,
    )
})

// protects=a library on a root Vite run (packageRoot absent or ".") is refused as INVALID_CONFIGURATION with the field, the reason and a message that names the fix, before anything starts; fails_when=the refusal lacks details.reason, the field or the way out, or fires with a nested packageRoot; no_claim=the service wiring (the start tests cover the call)
test('refuses library without a nested packageRoot with the reason library-needs-package-root', () => {
  // Arrange
  const absent = sample()
  delete absent.packageRoot
  const dot = { ...sample(), packageRoot: '.' }
  // Act
  const refusals = [absent, dot].map((candidate) => {
    try {
      assertViteLibraryNeedsPackageRoot(candidate)
    } catch (error) {
      return error
    }
    return undefined
  })
  // Assert
  for (const error of refusals) {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'INVALID_CONFIGURATION')
    assert.deepEqual(error.details, {
      field: 'configuration.library',
      reason: 'library-needs-package-root',
      sideEffects: 'none',
    })
    assert.match(error.message, /nested configuration\.packageRoot/)
    assert.match(error.message, /drop library/)
  }
  assert.doesNotThrow(() => assertViteLibraryNeedsPackageRoot(sample()))
  assert.doesNotThrow(() =>
    assertViteLibraryNeedsPackageRoot({ ...sample(), library: undefined }),
  )
})

// protects=a study of formats 3 to 8 never retains a library declaration, which only format 16 keeps; fails_when=the retained schema accepts library; no_claim=the format 16 variant, which the study tests cover
test('the retained configuration of formats 3 to 8 refuses a library declaration', () => {
  // Arrange
  const configuration = sample()
  // Act
  const result = retainedRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.equal(result.success, false)
})

// protects=a retained configuration with an explicit library of undefined is the older format and a declared library still needs format 16; fails_when=the refine tests the key instead of the value, which refuses the older format for a field that declares nothing; no_claim=the saved bytes (JSON drops an undefined field)
test('the retained configuration accepts an explicit undefined library and refuses a declared one', () => {
  // Arrange: no packageRoot, which the retained schema refuses for formats 3 to 8 on its own
  const { packageRoot: _packageRoot, ...flatConfiguration } = sample()
  const withoutLibrary = { ...flatConfiguration, library: undefined }
  const withLibrary = flatConfiguration
  // Act
  const undeclared = retainedRepositoryConfigSchema.safeParse(withoutLibrary)
  const declared = retainedRepositoryConfigSchema.safeParse(withLibrary)
  // Assert
  assert.equal(undeclared.success, true)
  assert.equal(declared.success, false)
})

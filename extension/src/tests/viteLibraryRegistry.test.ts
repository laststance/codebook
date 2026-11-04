import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ViteLibraryModuleSource } from '../utils/selectViteLibraryCandidate'
import { ViteLibraryRegistry } from '../utils/viteLibraryRegistry'

const LIBRARY = {
  name: '@scope/core',
  folder: 'packages/core',
  realFolder: '/repo/packages/core',
}

/** A module source that is never read; only its identity matters. */
function emptySource(): ViteLibraryModuleSource {
  return {
    list: async () => ({ modules: [], optimizedLibrary: false }),
    read: async () => '',
  }
}

// protects=decision D13 and memory: one source per generation and library is shared, and asking for a newer generation drops the older ones; fails_when=the same generation builds twice, or an older generation's source survives a newer request; no_claim=the run's reseal flow (integration)
test('shares a source within a generation and drops the sources of older generations', () => {
  // Arrange
  const registry = new ViteLibraryRegistry()
  let created = 0
  const create = () => {
    created += 1
    return emptySource()
  }
  // Act
  const first = registry.moduleSourceFor(0, LIBRARY, create)
  const again = registry.moduleSourceFor(0, LIBRARY, create)
  registry.moduleSourceFor(1, LIBRARY, create)
  const rebuiltOld = registry.moduleSourceFor(0, LIBRARY, create)
  // Assert
  assert.equal(first, again)
  assert.notEqual(rebuiltOld, first)
  assert.equal(created, 3)
})

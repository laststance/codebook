import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  crossRuntimeRepositoryConfigSchema,
  repositoryConfigSchema,
} from '../repositoryConfigSchemas'

/** A browser-only configuration on the Vite adapter, as an agent submits it. */
function viteConfiguration() {
  return {
    version: 1,
    adapter: 'vite-dev',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'display-theme',
      anchorIndex: 0,
    },
    source: {
      path: 'src/redux/themeSlice.ts',
      hash: 'a'.repeat(64),
      line: 19,
      column: 5,
    },
    action: {
      title: 'Change theme',
      selector: 'button[data-theme]',
      before: [{ kind: 'visible', selector: 'button[data-theme]' }],
      after: [{ kind: 'text', selector: '#label', equals: 'Dark' }],
    },
    inspections: [{ path: 'state.theme', mode: 'value', required: true }],
  }
}

test('the public schema accepts the vite-dev adapter for a browser stop', () => {
  // Act
  const parsed = repositoryConfigSchema.parse(viteConfiguration())
  // Assert
  assert.equal(parsed.adapter, 'vite-dev')
})

test('the public schema still refuses an unknown adapter name', () => {
  // Act / Assert
  assert.throws(
    () =>
      repositoryConfigSchema.parse({
        ...viteConfiguration(),
        adapter: 'webpack-dev',
      }),
    /adapter/,
  )
})

test('vite-dev refuses a server participant on the primary stop and on an additional stop, naming each', () => {
  // Arrange
  const base = { ...viteConfiguration(), version: 2 }
  const stop = {
    participant: 'server',
    source: base.source,
    anchorIndex: 1,
    inspections: base.inspections,
  }
  const primaryServer = { ...base, participant: 'server' }
  const additionalServer = {
    ...base,
    participant: 'browser',
    additionalStops: [
      { ...stop, participant: 'browser' },
      { ...stop, participant: 'server' },
    ],
  }
  // Act
  const primary = crossRuntimeRepositoryConfigSchema.safeParse(primaryServer)
  const additional =
    crossRuntimeRepositoryConfigSchema.safeParse(additionalServer)
  // Assert
  assert.equal(primary.success, false)
  assert.deepEqual(
    primary.error?.issues.map((issue) => issue.message),
    [
      'adapter "vite-dev" supports browser stops only; participant "server" is declared at configuration.participant.',
    ],
  )
  assert.equal(additional.success, false)
  assert.deepEqual(
    additional.error?.issues.map((issue) => issue.message),
    [
      'adapter "vite-dev" supports browser stops only; participant "server" is declared at configuration.additionalStops.1.participant.',
    ],
  )
})

test('vite-dev accepts browser participants in a cross-runtime configuration and next-dev-webpack keeps its server stops', () => {
  // Arrange
  const browserOnly = {
    ...viteConfiguration(),
    version: 2,
    participant: 'browser',
  }
  const nextServer = {
    ...browserOnly,
    adapter: 'next-dev-webpack',
    participant: 'server',
  }
  // Act
  const vite = crossRuntimeRepositoryConfigSchema.safeParse(browserOnly)
  const next = crossRuntimeRepositoryConfigSchema.safeParse(nextServer)
  // Assert
  assert.equal(vite.success, true)
  assert.equal(next.success, true)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFIGURED_PROFILE } from '../configuredProfile'
import { OPERATIONS_REPOSITORY_BROWSER_ADAPTERS } from '../constants'
import {
  crossRuntimeRepositoryConfigSchema,
  liveRepositoryConfigSchema,
  repositoryConfigSchema,
} from '../repositoryConfigSchemas'
import { readRepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'

import { createStaticPageRepository } from './utils/staticPageFixture'

/** A valid version 3 static-page configuration; the caller adds or changes fields. */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'static-page',
    book: { bookId: 'interface', revision: 1, nodeId: 'page', anchorIndex: 0 },
    source: {
      path: 'examples/page/index.html',
      hash: 'a'.repeat(64),
      line: 8,
      column: 3,
    },
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#go' }],
    after: [{ kind: 'text', selector: 'title', equals: '4' }],
    operations: [{ kind: 'click', title: 'Go', selector: '#go' }],
    inspections: [{ path: 'total', mode: 'value', required: true }],
    ...extra,
  }
}

// Value: protects=AC 1 a version 3 static-page configuration is accepted at the root, nested, with an .html entry path and with a library declaration, and the adapter is in the profile's adapter list; fails_when=the adapter value, packageRoot or library is refused; no_claim=the run that follows
test('a version 3 static-page configuration is accepted with packageRoot, an html entry path and a library', () => {
  // Arrange
  const spellings = [
    {},
    { packageRoot: '.' },
    { packageRoot: 'examples/page', entryPath: '/demo.html' },
    { packageRoot: 'examples/page', library: { packageRoot: 'packages/lib' } },
  ]
  // Act
  const results = spellings.map((extra) =>
    liveRepositoryConfigSchema.safeParse(configuration(extra)),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [true, true, true, true],
  )
  assert.ok(OPERATIONS_REPOSITORY_BROWSER_ADAPTERS.includes('static-page'))
  assert.match(
    JSON.stringify(CONFIGURED_PROFILE),
    /static-page \(since API 1\.42\)/,
  )
})

// Value: protects=AC 1 versions 1 and 2 refuse the static-page adapter, which an older Codebook would read as an unknown value; fails_when=either older shape accepts the adapter; no_claim=the message text
test('versions 1 and 2 refuse the static-page adapter', () => {
  // Arrange
  const version1 = { ...configuration(), version: 1 }
  const version2 = { ...configuration(), version: 2 }
  // Act
  const results = [
    repositoryConfigSchema.safeParse(version1),
    crossRuntimeRepositoryConfigSchema.safeParse(version2),
  ]
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false],
  )
})

// Value: protects=AC 1 a static-page configuration is browser stops only: a server participant is refused by the public schema, not by a later start; fails_when=a server stop is accepted under static-page; no_claim=the wording of the message
test('a static-page configuration refuses a server participant', () => {
  // Arrange
  const serverStop = configuration({ participant: 'server' })
  // Act
  const result = liveRepositoryConfigSchema.safeParse(serverStop)
  // Assert
  assert.equal(result.success, false)
  assert.match(
    JSON.stringify(result.error?.issues),
    /adapter \\"static-page\\" supports browser stops only/,
  )
})

// Value: protects=AC 1 the root readiness of status names a page at the repository root ready with its entry, and a root with no index.html no-entry-page, under the static-page key; fails_when=the key is missing from the adapter readiness or the root page is not judged; no_claim=the listing of pages below the root (discovery tests)
test('the root adapter readiness reports the static-page key for a page and for a folder without one', async (context) => {
  // Arrange
  const page = await createStaticPageRepository(context)
  const empty = await createStaticPageRepository(context, {})
  const signal = new AbortController().signal
  // Act
  const atPage = await readRepositoryAdapterReadiness(
    page.pageFolder,
    process.execPath,
    signal,
  )
  const atRoot = await readRepositoryAdapterReadiness(
    empty.root,
    process.execPath,
    signal,
  )
  // Assert
  assert.deepEqual(atPage['static-page'], {
    ready: true,
    missing: [],
    entry: 'index.html',
  })
  assert.deepEqual(atRoot['static-page'], {
    ready: false,
    missing: ['no-entry-page'],
    entry: 'index.html',
  })
})

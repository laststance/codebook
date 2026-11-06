import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  API_VERSION,
  LIBRARY_BUILD_FAILED_REASONS,
  LIBRARY_BUILD_TIMEOUT_MS,
  LIBRARY_BUILD_UNSUPPORTED_REASONS,
} from '../constants'
import { ERROR_RECOVERY } from '../errors'
import { nodeScriptConfigSchema } from '../nodeScriptConfigSchemas'
import { nodeScriptHelp } from '../nodeScriptHelp'

/** A book selection and a value-inspected stop every configuration of these tests shares. */
const BASE_CONFIGURATION = {
  version: 1,
  adapter: 'node-script',
  book: {
    bookId: 'scheduler',
    revision: 1,
    nodeId: 'scheduler',
    anchorIndex: 0,
  },
  entry: 'test-esm.mjs',
  source: { path: 'check.mjs', hash: 'c'.repeat(64), line: 3, column: 1 },
  inspections: [{ path: 'result', mode: 'value', required: true }],
} as const

// protects=a node-script configuration may name the repository's library package, as a folder or as the repository root; fails_when=library is refused or lost while parsing; no_claim=that the folder is a real package (the library build checks the file system)
test('accepts a library package root below the repository and the repository root itself', () => {
  // Arrange
  const below = {
    ...BASE_CONFIGURATION,
    library: { packageRoot: 'packages/toolkit' },
  }
  const root = { ...BASE_CONFIGURATION, library: { packageRoot: '.' } }
  // Act
  const parsedBelow = nodeScriptConfigSchema.parse(below)
  const parsedRoot = nodeScriptConfigSchema.parse(root)
  // Assert
  assert.deepEqual(parsedBelow.library, { packageRoot: 'packages/toolkit' })
  assert.deepEqual(parsedRoot.library, { packageRoot: '.' })
})

// protects=a configuration without library parses exactly as before, with no library key; fails_when=library appears as undefined-valued key or a default; no_claim=none beyond protects
test('parses a configuration without library with no library key', () => {
  // Arrange / Act
  const parsed = nodeScriptConfigSchema.parse(BASE_CONFIGURATION)
  // Assert
  assert.equal('library' in parsed, false)
  assert.equal(parsed.packageRoot, '.')
  assert.equal(parsed.loader, 'node')
})

// protects=the library declaration is strict: an extra member, an empty object or a package root that leaves the repository is refused; fails_when=a library with a command, an empty library or an absolute or parent path is accepted; no_claim=link and real-path refusals, which need the file system
test('refuses a library with an extra member, no package root or a path that leaves the repository', () => {
  // Arrange
  const declarations = [
    { packageRoot: 'packages/toolkit', buildCommand: 'rm -rf /' },
    {},
    { packageRoot: '../outside' },
    { packageRoot: '/etc' },
  ]
  // Act
  const results = declarations.map((library) =>
    nodeScriptConfigSchema.safeParse({ ...BASE_CONFIGURATION, library }),
  )
  // Assert
  assert.deepEqual(
    results.map((result) => result.success),
    [false, false, false, false],
  )
})

// protects=the API version is 1.33 and the library build budget is 180 seconds; fails_when=either constant drifts from the plan; no_claim=that a build finishes in the budget (native check)
test('serves API 1.33 with a 180 second library build budget', () => {
  // Arrange / Act / Assert
  assert.equal(API_VERSION, '1.33')
  assert.equal(LIBRARY_BUILD_TIMEOUT_MS, 180_000)
})

// protects=each library refusal and failure reason has its own recovery sentence and the reason lists are exactly the planned ones; fails_when=a reason is added or removed without its recovery or a recovery is lost; no_claim=that the runtime raises each reason (lane B)
test('words one recovery per library refusal and failure reason', () => {
  // Arrange
  const unsupported = ERROR_RECOVERY.LIBRARY_BUILD_UNSUPPORTED
  const failed = ERROR_RECOVERY.LIBRARY_BUILD_FAILED
  // Act / Assert
  assert.deepEqual(
    [...LIBRARY_BUILD_UNSUPPORTED_REASONS],
    [
      'outside-repository',
      'not-a-package',
      'not-a-dependency',
      'inside-example',
      'no-build-script',
      'package-manager-unsupported',
      'package-manager-unknown',
      'package-manager-missing',
      'library-not-installed',
      'peer-not-installed',
      'node-version',
    ],
  )
  assert.deepEqual(
    [...LIBRARY_BUILD_FAILED_REASONS],
    [
      'build-error',
      'timeout',
      'pack-error',
      'source-changed',
      'tracked-file-changed',
      'tracked-files-unverified',
    ],
  )
  for (const reason of LIBRARY_BUILD_UNSUPPORTED_REASONS)
    assert.ok(unsupported.includes(`${reason}: `), reason)
  for (const reason of LIBRARY_BUILD_FAILED_REASONS)
    assert.ok(failed.includes(`${reason}: `), reason)
  assert.match(failed, /stopped after 180 seconds/)
})

// protects=the node-script help lists both library codes with an anchor, their reasons and their recovery; fails_when=an agent cannot find the codes in the help; no_claim=the help's library section (a later lane)
test('lists the two library codes with anchors, reasons and recovery in the node-script help', () => {
  // Arrange / Act
  const codes = nodeScriptHelp().codes
  const unsupported = codes.find(
    (entry) => entry.code === 'LIBRARY_BUILD_UNSUPPORTED',
  )
  const failed = codes.find((entry) => entry.code === 'LIBRARY_BUILD_FAILED')
  // Assert
  assert.equal(
    unsupported?.anchor,
    'codebook://help/node-script#LIBRARY_BUILD_UNSUPPORTED',
  )
  assert.equal(
    failed?.anchor,
    'codebook://help/node-script#LIBRARY_BUILD_FAILED',
  )
  assert.match(unsupported?.when ?? '', /peer-not-installed/)
  assert.match(failed?.when ?? '', /tracked-files-unverified/)
  assert.equal(unsupported?.recovery, ERROR_RECOVERY.LIBRARY_BUILD_UNSUPPORTED)
  assert.equal(failed?.recovery, ERROR_RECOVERY.LIBRARY_BUILD_FAILED)
})

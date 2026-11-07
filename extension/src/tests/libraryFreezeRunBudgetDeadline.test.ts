import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { REPOSITORY_DISCOVERY_TIMEOUT_MS } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  freezeLibraryBuild,
  type FreezeLibraryBuildRequest,
} from '../utils/libraryBuildStop'

import {
  LIBRARY_APP_FOLDER,
  LIBRARY_NAME,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  libraryFixture,
} from './utils/libraryBuildHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const roots: string[] = []
after(async () => {
  await Promise.all(roots.map((root) => removeTestFolder(root)))
})

/** A map read that never answers and ends only when the discovery's signal aborts, so only a deadline can end it. */
const hangingRead: NonNullable<FreezeLibraryBuildRequest['readText']> = (
  _root,
  _path,
  _limit,
  signal,
) =>
  new Promise<string>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason))
  })

/** Stages the library fixture in a temp repository and builds a freeze request with the given budget. */
async function createRequest(
  spentMs: number,
  freezeLimitMs: number,
): Promise<FreezeLibraryBuildRequest> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'library-run-budget-')),
  )
  roots.push(root)
  await libraryFixture()({ directory: root, realRoot: root })
  // The fixture writes the builds only; the checked-out source the stop names is written here.
  await mkdir(join(root, 'packages/lib/src'), { recursive: true })
  await writeFile(join(root, LIBRARY_SOURCE_PATH), LIBRARY_SOURCE)
  return {
    repositoryRoot: root,
    packageRootRelative: LIBRARY_APP_FOLDER,
    library: {
      name: LIBRARY_NAME,
      folder: 'packages/lib',
      realFolder: join(root, 'packages/lib'),
    },
    stop: {
      path: LIBRARY_SOURCE_PATH,
      sha256: sha256(LIBRARY_SOURCE),
      line: 2,
      citationEndLine: 3,
    },
    signal: new AbortController().signal,
    budget: { readBytes: 0, spentMs },
    // A freeze limit far above the run's remaining time: only the run's budget can end the read.
    timeoutMs: freezeLimitMs,
    readText: hangingRead,
  }
}

// protects=A8 run budget: the freeze may not outlive the run's discovery time; fails_when=the freeze limit alone caps the read, so a run with no time left keeps waiting; no_claim=the 30 s value or the 5 s freeze limit
for (const [name, spentMs] of [
  ['the run has used all its discovery time', REPOSITORY_DISCOVERY_TIMEOUT_MS],
  [
    'the run has 1 ms of discovery time left',
    REPOSITORY_DISCOVERY_TIMEOUT_MS - 1,
  ],
] as const) {
  test(
    `refuses as deadline when ${name}, though the freeze limit is far larger`,
    { timeout: 10_000 },
    async () => {
      // Arrange
      const request = await createRequest(spentMs, 600_000)
      // Act
      const refusal = await freezeLibraryBuild(request).then(
        () => assert.fail('expected a refusal'),
        (error: { code: string; details: Record<string, unknown> }) => error,
      )
      // Assert
      assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
      assert.equal(refusal.details.reason, 'library-build-unmapped')
      assert.equal(refusal.details.cause, 'deadline')
      assert.equal(refusal.details.sideEffects, 'none')
    },
  )
}

// protects=A8 run budget: time spent is added to the run's counter; fails_when=a refused freeze leaves spentMs unchanged; no_claim=exact milliseconds
test('adds the time of a freeze that hit the deadline to the run budget', async () => {
  // Arrange
  const request = await createRequest(REPOSITORY_DISCOVERY_TIMEOUT_MS, 600_000)
  // Act
  await freezeLibraryBuild(request).then(
    () => assert.fail('expected a refusal'),
    () => undefined,
  )
  // Assert
  assert.ok(request.budget.spentMs > REPOSITORY_DISCOVERY_TIMEOUT_MS)
})

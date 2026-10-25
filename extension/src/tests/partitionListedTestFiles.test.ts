import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import { test } from 'node:test'

import { partitionListedTestFiles } from '../utils/partitionListedTestFiles'

// Value: protects=a listing of many files being compared with the cited test 64 real-path reads at a time while keeping Vitest's order and the cited entry; fails_when=the entries are resolved one after another, so a short filter that lists thousands of files in a large repository holds the start's preparation, or the parallel reads lose the order; why_new=Cycle 0053 Step 11 round 2 (Claude adversarial, finding 6); seam=realpath is replaced by one that counts the reads in flight; no_claim=the real file system's speed
test('a listing of many files is resolved 64 at a time and keeps the cited entry and the order', async (context) => {
  // Arrange
  const entries = Array.from({ length: 150 }, (_, index) => ({
    file: `/repo/packages/p${String(index).padStart(3, '0')}/a.test.ts`,
  }))
  let inFlight = 0
  let mostInFlight = 0
  context.mock.method(fsPromises, 'realpath', async (path: string) => {
    inFlight++
    mostInFlight = Math.max(mostInFlight, inFlight)
    await new Promise((resolve) => setImmediate(resolve))
    inFlight--
    return path === '/repo/packages/p100/a.test.ts'
      ? '/repo/packages/a/src/a.test.ts'
      : path
  })

  // Act
  const { cited, others } = await partitionListedTestFiles(
    entries,
    '/repo/packages/a/src/a.test.ts',
  )

  // Assert
  assert.equal(mostInFlight, 64)
  assert.deepEqual(cited, [{ file: '/repo/packages/p100/a.test.ts' }])
  assert.equal(others.length, 149)
  assert.equal(others[0]!.file, '/repo/packages/p000/a.test.ts')
  assert.equal(others[148]!.file, '/repo/packages/p149/a.test.ts')
})

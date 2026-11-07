import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { legacyNodeScriptHistoryHeaderSchema } from './utils/legacyNodeScriptHistoryHeaderSchema'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'

/** A format 1 header the frozen schema of 0.2.92.0 accepted. */
const FORMAT_ONE_HEADER = {
  formatVersion: 1,
  profile: 'node-script',
  workspaceKey: 'a'.repeat(64),
  studyId: `${INSTANCE_ID}_${RUN_ID}`,
  instanceId: INSTANCE_ID,
  runId: RUN_ID,
  createdAt: '2026-11-07T00:00:00.000Z',
  question: 'What does the script print?',
  packageRoot: 'examples/node',
  entry: 'checks.cjs',
  loader: 'node',
  declaredStops: [{ path: 'checks.cjs', line: 3 }],
  repositoryRevision: { revision: 'b'.repeat(40), dirty: false },
  sourceHashes: [{ path: 'checks.cjs', hash: 'c'.repeat(64) }],
}

// protects=the frozen format 1 header schema keeps its own copy of every schema and limit it uses, so a later change to the product schemas cannot move what an older Codebook is shown to accept; fails_when=the fixture imports a live schema or constant from src again; no_claim=that the copy still equals 0.2.92.0 byte for byte
test('the frozen format 1 header fixture imports nothing from the product source', async () => {
  // Arrange
  const source = await readFile(
    join(
      __dirname,
      '../../src/tests/utils/legacyNodeScriptHistoryHeaderSchema.ts',
    ),
    'utf8',
  )
  // Act
  const productImports = source
    .split('\n')
    .filter((line) => /from '\.\.\/\.\.\//.test(line))
  // Assert
  assert.deepEqual(productImports, [])
})

// protects=the frozen schema still accepts a format 1 header and refuses format 2, bad ids, a seventeenth stop and an unknown key; fails_when=the copied rules loosen; no_claim=the product schema
test('the frozen format 1 header schema accepts format 1 only and keeps its limits', () => {
  // Arrange / Act
  const accepted =
    legacyNodeScriptHistoryHeaderSchema.safeParse(FORMAT_ONE_HEADER)
  const formatTwo = legacyNodeScriptHistoryHeaderSchema.safeParse({
    ...FORMAT_ONE_HEADER,
    formatVersion: 2,
  })
  const badStudy = legacyNodeScriptHistoryHeaderSchema.safeParse({
    ...FORMAT_ONE_HEADER,
    studyId: `${RUN_ID}_${INSTANCE_ID}`,
  })
  const tooManyStops = legacyNodeScriptHistoryHeaderSchema.safeParse({
    ...FORMAT_ONE_HEADER,
    declaredStops: Array.from({ length: 17 }, (_, line) => ({
      path: 'checks.cjs',
      line: line + 1,
    })),
  })
  const extraKey = legacyNodeScriptHistoryHeaderSchema.safeParse({
    ...FORMAT_ONE_HEADER,
    library: { packageRoot: 'packages/widgets' },
  })
  // Assert
  assert.equal(accepted.success, true)
  assert.equal(formatTwo.success, false)
  assert.equal(badStudy.success, false)
  assert.equal(tooManyStops.success, false)
  assert.equal(extraKey.success, false)
})

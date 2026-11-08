import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { collectApiEnvFileValues } from '../utils/collectApiEnvFileValues'

import { removeTestFolder } from './utils/removeTestFolder'

// Value: protects=one oversized env file does not leave the readable .env of the same folder unmasked; fails_when=an oversized .env.local drops the values of .env; no_claim=the size of the bound itself
test('a readable .env is still masked when an oversized .env.local sits beside it', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'api-env-'))
  context.after(() => removeTestFolder(root))
  await writeFile(join(root, '.env'), 'DB_PASSWORD=placeholder-db-value\n')
  await writeFile(join(root, '.env.local'), `BIG=${'x'.repeat(2_000_000)}\n`)
  // Act
  const values = await collectApiEnvFileValues([root])
  // Assert
  assert.deepEqual(values, ['placeholder-db-value'])
})

// Value: protects=a value written as a reference and its expanded form are both masked; fails_when=the raw value of a reference is not collected; no_claim=expansion semantics
test('a raw value and its expanded form are both collected', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'api-env-'))
  context.after(() => removeTestFolder(root))
  await writeFile(
    join(root, '.env'),
    'BASE=placeholder-base\nURL=${BASE}/path-suffix\n',
  )
  // Act
  const values = await collectApiEnvFileValues([root])
  // Assert
  assert.deepEqual(values.sort(), [
    '${BASE}/path-suffix',
    'placeholder-base',
    'placeholder-base/path-suffix',
  ])
})

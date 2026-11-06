import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { parseFlatSourceMap } from '../utils/parseFlatSourceMap'
import { readChunkSourceMap } from '../utils/readChunkSourceMap'
import { resolveMappedStop } from '../utils/resolveMappedStop'

import { createRepositoryFixture } from './utils/chromeExtensionFixture'

// protects=a flat map with a null entry in sources still lists its other sources and keeps their embedded text aligned; fails_when=the whole map is reported malformed or the text of a later source shifts onto the wrong path; no_claim=nothing about how a build produces the null; the map text is hand-written
test('a source map with a null source still lists its other sources with their own text', () => {
  // Arrange
  const text = JSON.stringify({
    version: 3,
    sources: ['../src/a.ts', null, '../src/c.ts'],
    sourcesContent: ['text a', 'text null', 'text c'],
    mappings: '',
  })

  // Act
  const parsed = parseFlatSourceMap(text)

  // Assert
  assert.deepEqual(parsed, {
    sources: ['../src/a.ts', '../src/c.ts'],
    sourceRoot: '',
    sourcesContent: ['text a', 'text c'],
  })
})

// protects=the map reference is read only from the comment on the chunk's last non-empty line; fails_when=a string literal containing a sourceMappingURL comment earlier in the chunk is used as the map reference; no_claim=nothing about block comments or data: maps; chunk and maps are hand-written files
test('a sourceMappingURL inside a string literal is ignored and the trailing comment is used', async (context) => {
  // Arrange
  const root = await createRepositoryFixture(context, {
    'build/chunk.js':
      'const note = "//# sourceMappingURL=fake.js.map"\nexport {}\n//# sourceMappingURL=real.js.map\n\n',
    'build/real.js.map': JSON.stringify({
      version: 3,
      sources: ['../src/real.ts'],
      mappings: '',
    }),
    'build/fake.js.map': JSON.stringify({
      version: 3,
      sources: ['../src/fake.ts'],
      mappings: '',
    }),
  })

  // Act
  const result = await readChunkSourceMap(
    join(root, 'build/chunk.js'),
    join(root, 'build'),
  )

  // Assert
  assert.equal(result.status, 'map')
  assert.deepEqual(result.status === 'map' && result.map.sources, [
    '../src/real.ts',
  ])
})

// protects=a chunk whose last non-empty line is code names no map even when an earlier line holds a map comment; fails_when=an earlier comment is accepted as the chunk's map; no_claim=nothing about where a build places its comment
test('a sourceMappingURL that is not on the last non-empty line names no map', async (context) => {
  // Arrange
  const root = await createRepositoryFixture(context, {
    'build/chunk.js':
      '//# sourceMappingURL=fake.js.map\nexport const value = 1\n',
  })

  // Act
  const result = await readChunkSourceMap(
    join(root, 'build/chunk.js'),
    join(root, 'build'),
  )

  // Assert
  assert.deepEqual(result, { status: 'none' })
})

// protects=the pinned sha256 is the hash of the file bytes that were compared, including bytes that are not valid UTF-8; fails_when=the hash is of text re-encoded from the comparison; no_claim=does not prove a single read: there is no seam to change the file between reads, so a double read would also pass; the file system is real and the mapped sources are built by hand
test('the pinned hash is the hash of the compared file bytes', async (context) => {
  // Arrange
  const bytes = Buffer.from([0x61, 0xff, 0x0a])
  const root = await createRepositoryFixture(context, {
    'project/src/a.ts': 'placeholder',
  })
  const sourcePath = join(root, 'project/src/a.ts')
  await writeFile(sourcePath, bytes)
  const mapped = {
    context: 'page' as const,
    sources: new Map([
      [
        sourcePath,
        {
          chunk: 'chunk.js',
          map: 'chunk.js.map',
          sourcesContent: bytes.toString('utf8'),
        },
      ],
    ]),
    unlisted: [],
    unfollowed: [],
    projectRoot: join(root, 'project'),
  }

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })

  // Assert
  assert.equal(result.ok, true)
  assert.equal(
    result.ok && result.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  )
})

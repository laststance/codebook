import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { extractPackageTarball } from '../utils/extractPackageTarball'

import { buildTestTarball, paxRecord } from './utils/buildTestTarArchive'

const temporaryFolders: string[] = []
after(() => {
  for (const folder of temporaryFolders)
    rmSync(folder, { recursive: true, force: true })
})

/** Writes a tarball into a fresh folder and returns its path with the unpack folder inside it. */
function setUp(archive: Buffer): { tarballPath: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'codebook-tarball-'))
  temporaryFolders.push(root)
  const tarballPath = join(root, 'package.tgz')
  writeFileSync(tarballPath, archive)
  return { tarballPath, folder: join(root, 'unpacked') }
}

/** Awaits a rejection and returns its message. */
async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected the extraction to reject.')
}

// protects=a regular tarball unpacks with its first path segment dropped; fails_when=files land under package/ or are missed; no_claim=real npm tarballs
test('unpacks files and folders without the package/ segment', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([
      { name: 'package/', typeFlag: '5' },
      { name: 'package/package.json', content: '{"name":"lib"}' },
      { name: 'package/dist/index.mjs', content: 'export {}' },
    ]),
  )
  // Act
  const count = await extractPackageTarball(tarballPath, folder)
  // Assert
  assert.equal(count, 2)
  assert.equal(
    readFileSync(join(folder, 'package.json'), 'utf8'),
    '{"name":"lib"}',
  )
  assert.equal(
    readFileSync(join(folder, 'dist', 'index.mjs'), 'utf8'),
    'export {}',
  )
})

// protects=an entry that climbs out of the folder is refused and writes nothing outside; fails_when=the file lands next to the folder; no_claim=symlink races on disk
test('refuses an entry whose name leaves the folder', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([{ name: 'package/../../escaped.txt', content: 'x' }]),
  )
  // Act
  const message = await messageOf(extractPackageTarball(tarballPath, folder))
  // Assert
  assert.equal(
    message,
    'The tarball entry "package/../../escaped.txt" leaves the folder.',
  )
  assert.equal(existsSync(join(folder, '..', 'escaped.txt')), false)
})

// protects=an absolute entry name is kept inside the folder; fails_when=the file is written at the absolute path; no_claim=the exact in-folder spelling beyond the dropped first segment
test('keeps an absolute entry name inside the folder', async () => {
  // Arrange
  const outside = mkdtempSync(join(tmpdir(), 'codebook-tarball-outside-'))
  temporaryFolders.push(outside)
  const { tarballPath, folder } = setUp(
    buildTestTarball([{ name: `${outside}/stolen.txt`, content: 'x' }]),
  )
  // Act
  await extractPackageTarball(tarballPath, folder)
  // Assert
  assert.equal(existsSync(join(outside, 'stolen.txt')), false)
})

// protects=symlink and hard link entries are refused and leave no file; fails_when=a link is created or skipped silently; no_claim=device or fifo entries
for (const [label, typeFlag] of [
  ['symlink', '2'],
  ['hard link', '1'],
] as const) {
  test(`refuses a ${label} entry`, async () => {
    // Arrange
    const { tarballPath, folder } = setUp(
      buildTestTarball([
        { name: 'package/link', typeFlag, linkName: '/etc/passwd' },
      ]),
    )
    // Act
    const message = await messageOf(extractPackageTarball(tarballPath, folder))
    // Assert
    assert.equal(
      message,
      'The tarball entry "package/link" is neither a file nor a folder.',
    )
    assert.equal(existsSync(join(folder, 'link')), false)
  })
}

// protects=a pax path record names the file that follows; fails_when=the short header name is used; no_claim=other pax keys
test('applies a pax path record to the next entry', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([
      {
        name: 'PaxHeader',
        typeFlag: 'x',
        content: paxRecord('path', 'package/deep/er/real.txt'),
      },
      { name: 'package/short.txt', content: 'pax' },
    ]),
  )
  // Act
  await extractPackageTarball(tarballPath, folder)
  // Assert
  assert.equal(
    readFileSync(join(folder, 'deep', 'er', 'real.txt'), 'utf8'),
    'pax',
  )
  assert.equal(existsSync(join(folder, 'short.txt')), false)
})

// protects=a GNU long name names the file that follows; fails_when=the cut 100-byte name is used; no_claim=GNU long link names
test('applies a GNU long name to the next entry', async () => {
  // Arrange
  const longName = `package/${'d'.repeat(60)}/${'f'.repeat(60)}.txt`
  const { tarballPath, folder } = setUp(
    buildTestTarball([
      { name: '././@LongLink', typeFlag: 'L', content: `${longName}\0` },
      { name: longName.slice(0, 100), content: 'gnu' },
    ]),
  )
  // Act
  await extractPackageTarball(tarballPath, folder)
  // Assert
  assert.equal(
    readFileSync(join(folder, 'd'.repeat(60), `${'f'.repeat(60)}.txt`), 'utf8'),
    'gnu',
  )
})

// protects=more entries than the limit are refused; fails_when=an unbounded archive is walked; no_claim=the production limit value
test('refuses an archive with more entries than the entry limit', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([
      { name: 'package/a.txt', content: 'a' },
      { name: 'package/b.txt', content: 'b' },
      { name: 'package/c.txt', content: 'c' },
    ]),
  )
  // Act
  const message = await messageOf(
    extractPackageTarball(tarballPath, folder, {
      totalBytes: 100000,
      entryCount: 2,
    }),
  )
  // Assert
  assert.equal(message, 'The tarball holds too many entries.')
})

// protects=more file bytes than the limit are refused; fails_when=the files are all written; no_claim=the production limit value
test('refuses an archive whose files pass the byte limit', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([{ name: 'package/big.txt', content: 'x'.repeat(11) }]),
  )
  // Act
  const message = await messageOf(
    extractPackageTarball(tarballPath, folder, {
      totalBytes: 10,
      entryCount: 10,
    }),
  )
  // Assert
  assert.equal(message, 'The tarball unpacks to too many bytes.')
  assert.equal(existsSync(join(folder, 'big.txt')), false)
})

// protects=a gzip stream that expands past the byte limit is stopped while it is gunzipped; fails_when=the whole expansion is held in memory and the empty archive reads as success; no_claim=the production limit value
test('stops a gzip bomb at the byte limit before reading the archive', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(gzipSync(Buffer.alloc(100_000)))
  // Act
  const message = await messageOf(
    extractPackageTarball(tarballPath, folder, {
      totalBytes: 1000,
      entryCount: 10,
    }),
  )
  // Assert
  assert.equal(message, 'The tarball unpacks to too many bytes.')
})

// protects=executable bits are kept as 0o755 and others as 0o644; fails_when=a bin script loses its executable bit or a plain file gains it; no_claim=Windows permissions
test('keeps the executable bit of a script and leaves other files plain', async () => {
  // Arrange
  const { tarballPath, folder } = setUp(
    buildTestTarball([
      {
        name: 'package/bin/run.js',
        content: '#!/usr/bin/env node',
        mode: 0o755,
      },
      { name: 'package/readme.md', content: 'text', mode: 0o644 },
    ]),
  )
  // Act
  await extractPackageTarball(tarballPath, folder)
  // Assert
  assert.equal(statSync(join(folder, 'bin', 'run.js')).mode & 0o100, 0o100)
  assert.equal(statSync(join(folder, 'readme.md')).mode & 0o111, 0)
})

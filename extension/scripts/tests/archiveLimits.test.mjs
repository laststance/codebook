import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import {
  mkdtemp,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { readVsixEntries } from '../utils/readVsixEntries.mjs'

/** Creates an owned real ZIP when archive-limit tests need compressed input; cleanup belongs to the test context. @example await archiveFixture(context, [['entry', Buffer.from('bytes')]]) */
async function archiveFixture(context, entries) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-archive-limits-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'candidate.vsix'),
    archive = new ZipFile()
  for (const [name, content] of entries) archive.addBuffer(content, name)
  archive.end()
  await pipeline(archive.outputStream, createWriteStream(path))
  return path
}

test('a VSIX larger than 64 MiB is rejected before ZIP parsing', async (context) => {
  // Arrange: a sparse file avoids allocating the entire rejected input.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-archive-size-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'oversized.vsix')
  await writeFile(path, '')
  await truncate(path, 67_108_865)
  // Act / Assert
  await assert.rejects(
    readVsixEntries(path),
    /Expected a regular VSIX within the archive size limit/,
  )
})

test('symlink and directory inputs cannot be accepted as ordinary VSIX files', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-archive-input-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const target = await archiveFixture(context, [
    ['entry.txt', Buffer.from('bounded bytes')],
  ])
  const alias = join(directory, 'alias.vsix')
  await symlink(target, alias)
  // Act / Assert
  await assert.rejects(readVsixEntries(alias), { code: 'ELOOP' })
  await assert.rejects(
    readVsixEntries(directory),
    /Expected a regular VSIX within the archive size limit/,
  )
})

test('small compressed entries whose combined content exceeds 64 MiB are rejected', async (context) => {
  // Arrange: neither entry alone exceeds the limit; the accumulated expansion must be checked.
  const path = await archiveFixture(context, [
    ['first.bin', Buffer.alloc(33_554_432)],
    ['second.bin', Buffer.alloc(33_554_433)],
  ])
  assert.ok(
    (await stat(path)).size < 100_000,
    'The fixture must pass the compressed archive size gate',
  )
  // Act / Assert
  await assert.rejects(
    readVsixEntries(path),
    /VSIX exceeds the entry or expanded size limit/,
  )
})

test('2048 ordinary ZIP entries remain readable and a 2049th entry is rejected', async (context) => {
  // Arrange
  const entries = Array.from({ length: 2048 }, (_, index) => [
    `entry-${index}.txt`,
    Buffer.from('x'),
  ])
  const accepted = await archiveFixture(context, entries)
  const rejected = await archiveFixture(context, [
    ...entries,
    ['one-too-many.txt', Buffer.from('x')],
  ])
  // Act / Assert
  assert.equal((await readVsixEntries(accepted)).size, 2048)
  await assert.rejects(
    readVsixEntries(rejected),
    /VSIX exceeds the entry or expanded size limit/,
  )
})

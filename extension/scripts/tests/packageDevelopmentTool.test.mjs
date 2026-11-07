import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ZipFile } from 'yazl'

import { readVsixEntries } from '../utils/readVsixEntries.mjs'
import { verifyPackageContent } from '../utils/verifyPackageContent.mjs'

const checkPackage = fileURLToPath(
  new URL('../check-package.mjs', import.meta.url),
)

/** Writes a tiny VSIX holding the given `[name, text]` entries and returns its path. */
async function tinyVsix(context, entries) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-dev-tool-vsix-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'candidate.vsix')
  const archive = new ZipFile()
  for (const [name, text] of entries) archive.addBuffer(Buffer.from(text), name)
  archive.end()
  await pipeline(archive.outputStream, createWriteStream(path))
  return path
}

// Value: protects=the development-only recorder never shipping in the VSIX; fails_when=an archive holding tools/host-event-recorder passes the content check or is refused without naming the tool; why_new=Cycle 0094 task 12 (Discussion 183); seam=a tiny real ZIP read by the package reader; no_claim=that a full package build stays free of it (the inventory check covers that)
test('the package check refuses a VSIX that contains the host event recorder, naming it', async (context) => {
  // Arrange
  const path = await tinyVsix(context, [
    ['extension/package.json', '{}'],
    ['extension/tools/host-event-recorder/extension.js', 'module.exports = {}'],
  ])
  const entries = await readVsixEntries(path)

  // Act / Assert
  await assert.rejects(
    verifyPackageContent(entries),
    /Development-only tool entered the package: extension\/tools\/host-event-recorder\/extension\.js/,
  )
})

// Value: protects=the same refusal reaching the command a person or CI runs; fails_when=check-package.mjs exits 0 for such an archive; why_new=Cycle 0094 task 12; seam=real child process; no_claim=a complete valid package
test('check-package.mjs exits non-zero for a VSIX named after the recorder', async (context) => {
  // Arrange
  const path = await tinyVsix(context, [
    ['extension/package.json', '{}'],
    ['extension/codebook-host-event-recorder/package.json', '{}'],
  ])

  // Act
  const result = spawnSync(process.execPath, [checkPackage, path], {
    encoding: 'utf8',
  })

  // Assert
  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /Development-only tool entered the package: extension\/codebook-host-event-recorder\/package\.json/,
  )
})

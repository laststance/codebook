import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

test('unsupported historical study files remain on disk and cannot start a runtime or certify learning', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-retired-history-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const reference = createConfiguredStudy(),
    library = new LearningLibrary(directory, reference.workspaceKey)
  const path = join(directory, `${reference.id}.study.json`),
    original = JSON.stringify({
      version: 1,
      id: reference.id,
      retained: 'owner data',
    })
  await writeFile(path, original)
  // Act
  const catalog = await library.list()
  // Assert
  assert.equal(catalog[0]?.metadata, 'unavailable')
  await assert.rejects(library.readStudy(reference.id))
  assert.equal(await readFile(path, 'utf8'), original)
})

test('a corrupt preferred repository archive cannot fall back to an older file or overwrite it', async (context) => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-history-precedence-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createConfiguredStudy(),
    library = new LearningLibrary(directory, study.workspaceKey)
  await library.saveStudy(study)
  const older = join(directory, `${study.id}.study.v2.json`),
    original = JSON.stringify({ version: 2, retained: true })
  await writeFile(older, original)
  await writeFile(join(directory, `${study.id}.study.v3.json`), '{invalid')
  // Act / Assert
  await assert.rejects(library.readStudy(study.id))
  assert.equal((await library.list())[0]?.metadata, 'unavailable')
  assert.equal(await readFile(older, 'utf8'), original)
})

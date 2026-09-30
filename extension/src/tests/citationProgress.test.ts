import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LearningLibrary } from '../learningLibrary'
import { citationContext } from '../utils/citationContext'
import { citationLearningState } from '../utils/citationLearningState'
import { learningState } from '../studyModel'

const workspaceKey = '1'.repeat(64),
  sourceHash = '2'.repeat(64)
const primary = {
  path: 'src/main.ts',
  hash: sourceHash,
  startLine: 1,
  endLine: 8,
}
const secondary = {
  path: 'src/store.ts',
  hash: '3'.repeat(64),
  startLine: 2,
  endLine: 12,
}
const at = '2026-09-19T10:00:00.000Z'

test('article understanding survives prose and citation ordering but changed paths, ranges and citation sets need a new decision', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    item = 'repository/architecture/storage'
  const intent = {
    id: randomUUID(),
    item,
    sourceHash,
    at,
    understood: true,
    context: citationContext([primary, secondary]),
  }
  // Act
  await library.decide(intent)
  const progress = await new LearningLibrary(
    directory,
    workspaceKey,
  ).readProgress()
  // Assert
  assert.equal(
    citationLearningState(progress, item, [secondary, primary, primary])
      .understood,
    true,
  )
  for (const changed of [
    [primary],
    [primary, { ...secondary, hash: '4'.repeat(64) }],
    [primary, { ...secondary, endLine: 13 }],
    [primary, { ...secondary, path: 'src/renamed.ts' }],
  ]) {
    assert.equal(
      citationLearningState(progress, item, changed).understood,
      false,
    )
    assert.equal(
      citationLearningState(progress, item, changed).reviewNeeded,
      true,
    )
  }
  assert.equal(progress.decisions.length, 1)
  assert.equal(progress.decisions[0]?.id, intent.id)
  assert.equal(
    citationLearningState(progress, 'repository/another-book/storage', [
      primary,
      secondary,
    ]).understood,
    false,
  )
})

test('runtime primary-hash understanding never acknowledges additional article citations and article decisions do not check runtime', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    item = 'repository/interface/theme'
  await library.decide({
    id: randomUUID(),
    item,
    sourceHash,
    understood: true,
    at,
  })
  // Act / Assert
  const runtime = await library.readProgress()
  assert.equal(learningState(runtime, item, sourceHash).understood, true)
  assert.equal(
    citationLearningState(runtime, item, [primary, secondary]).understood,
    false,
  )
  await library.decide({
    id: randomUUID(),
    item,
    sourceHash,
    understood: false,
    at,
  })
  const article = await library.decide({
    id: randomUUID(),
    item,
    sourceHash,
    understood: true,
    at,
    context: citationContext([primary, secondary]),
  })
  assert.equal(learningState(article, item, sourceHash).understood, false)
  assert.equal(
    citationLearningState(article, item, [primary, secondary]).understood,
    true,
  )
})

test('unchecking and identical intent retries affect only the original complete citation context', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    item = 'repository/book/node'
  const first = {
    id: randomUUID(),
    item,
    sourceHash,
    at,
    understood: true,
    context: citationContext([primary, secondary]),
  }
  const other = {
    ...first,
    id: randomUUID(),
    context: citationContext([primary]),
  }
  await library.decide(first)
  await library.decide(other)
  const uncheck = { ...first, id: randomUUID(), understood: false }
  // Act
  await library.decide(uncheck)
  const retried = await library.decide(uncheck)
  // Assert
  assert.equal(retried.decisions.length, 3)
  assert.equal(
    citationLearningState(retried, item, [primary, secondary]).understood,
    false,
  )
  assert.equal(citationLearningState(retried, item, [primary]).understood, true)
  await assert.rejects(
    library.decide({ ...uncheck, context: citationContext([primary]) }),
    /different decision/,
  )
})

test('corrupt, unknown or untyped v3 progress never falls back to readable v2 choices', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-context-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const legacy = {
    version: 2,
    workspaceKey,
    decisions: [
      {
        id: randomUUID(),
        item: 'repository/interface/theme',
        sourceHash,
        understood: true,
        at,
      },
    ],
  }
  await writeFile(join(directory, 'progress.v2.json'), JSON.stringify(legacy))
  const library = new LearningLibrary(directory, workspaceKey)
  // Act / Assert
  for (const invalid of [
    '{broken',
    JSON.stringify({ ...legacy, version: 4 }),
    JSON.stringify({ ...legacy, version: 3 }),
  ]) {
    await writeFile(join(directory, 'progress.v3.json'), invalid)
    await assert.rejects(library.readProgress())
    await assert.rejects(
      library.selectRepository({
        bookId: 'book',
        revision: 1,
        nodeId: 'node',
        anchorIndex: 0,
      }),
    )
    assert.equal(
      await readFile(join(directory, 'progress.v3.json'), 'utf8'),
      invalid,
    )
  }
  assert.equal(
    await readFile(join(directory, 'progress.v2.json'), 'utf8'),
    JSON.stringify(legacy),
  )
})

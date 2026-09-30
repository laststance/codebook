import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { inspectDeepWikiFreshness } from '../utils/inspectDeepWikiFreshness'

const runGit = promisify(execFile)

test('Wiki freshness detects edited, deleted and added source against a clean generated revision', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-freshness-'))
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const revision = revisionOutput.trim()
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  try {
    // Act / Assert
    assert.equal(
      (await inspectDeepWikiFreshness(root, included, revision, [])).status,
      'current',
    )
    await writeFile(join(root, 'source.ts'), 'export const answer = 2;\n')
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, []))
        .changedPaths,
      ['source.ts'],
    )
    await writeFile(join(root, 'source.ts'), original)
    await writeFile(join(root, 'added.ts'), 'export const added = true;\n')
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, [])).addedPaths,
      ['added.ts'],
    )
    await rm(join(root, 'added.ts'))
    await mkdir(join(root, '.codebook', 'wiki'), { recursive: true })
    await writeFile(
      join(root, '.codebook', 'wiki', 'generated.ts'),
      'export const generated = true;\n',
    )
    assert.equal(
      (await inspectDeepWikiFreshness(root, included, revision, [])).status,
      'current',
    )
    await rm(join(root, 'source.ts'))
    assert.deepEqual(
      (await inspectDeepWikiFreshness(root, included, revision, []))
        .changedPaths,
      ['source.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a Wiki generated from dirty source reports current until another source file is added', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-dirty-'),
  )
  const root = await realpath(directory)
  await writeFile(join(root, 'README.md'), 'Database client uses Drizzle.\n')
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'README.md'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  await writeFile(
    join(root, 'README.md'),
    'Database client uses postgres-js and Drizzle.\n',
  )
  const includedSources = [
    {
      path: 'README.md',
      sha256: createHash('sha256')
        .update('Database client uses postgres-js and Drizzle.\n')
        .digest('hex'),
    },
  ]
  try {
    // Act / Assert
    assert.equal(
      (
        await inspectDeepWikiFreshness(
          root,
          includedSources,
          revisionOutput.trim(),
          [],
        )
      ).status,
      'current',
    )
    await writeFile(
      join(root, 'new-source.ts'),
      'export const database = true;\n',
    )
    assert.deepEqual(
      (
        await inspectDeepWikiFreshness(
          root,
          includedSources,
          revisionOutput.trim(),
          [],
        )
      ).addedPaths,
      ['new-source.ts'],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Wiki freshness stays unknown when its generated revision cannot prove additions', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-unknown-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(original).digest('hex'),
        },
      ],
      undefined,
      [],
    )
    // Assert
    assert.equal(result.status, 'unknown')
    assert.match(result.reason ?? '', /Added source files could not be checked/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a file added under an excluded directory keeps the Wiki current', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-excluded-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  await mkdir(join(root, 'examples', 'basic'), { recursive: true })
  await writeFile(
    join(root, 'examples', 'basic', 'demo.ts'),
    'export const demo = true;\n',
  )
  await mkdir(join(root, 'examples-extra'), { recursive: true })
  await writeFile(
    join(root, 'examples-extra', 'other.ts'),
    'export const other = true;\n',
  )
  try {
    // Act
    const withoutSlash = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['examples'],
    )
    const withSlash = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['examples/', 'examples-extra/**'],
    )
    // Assert
    assert.deepEqual(
      withoutSlash.addedPaths,
      ['examples-extra/other.ts'],
      'a directory entry excludes its files but not a sibling with the same prefix',
    )
    assert.equal(withSlash.status, 'current')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a file added under a directory glob exclusion keeps the Wiki current', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-freshness-directory-glob-'),
  )
  const root = await realpath(directory)
  const original = 'export const answer = 1;\n'
  await writeFile(join(root, 'source.ts'), original)
  await runGit('git', ['init', '-q'], { cwd: root })
  await runGit('git', ['add', 'source.ts'], { cwd: root })
  await runGit(
    'git',
    [
      '-c',
      'user.name=Codebook',
      '-c',
      'user.email=codebook@example.invalid',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  )
  const { stdout: revisionOutput } = await runGit(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  )
  const included = [
    {
      path: 'source.ts',
      sha256: createHash('sha256').update(original).digest('hex'),
    },
  ]
  await mkdir(join(root, 'src', 'fixtures'), { recursive: true })
  await writeFile(
    join(root, 'src', 'fixtures', 'invoice.ts'),
    'export const invoice = {};\n',
  )
  await mkdir(join(root, 'packages', 'web', 'dist'), { recursive: true })
  await writeFile(
    join(root, 'packages', 'web', 'dist', 'bundle.js'),
    'export {};\n',
  )
  await writeFile(
    join(root, 'src', 'fixtures-note.ts'),
    'export const note = true;\n',
  )
  try {
    // Act
    const result = await inspectDeepWikiFreshness(
      root,
      included,
      revisionOutput.trim(),
      ['**/fixtures', 'packages/*/dist/'],
    )
    // Assert
    assert.deepEqual(
      result.addedPaths,
      ['src/fixtures-note.ts'],
      'a directory glob excludes the files inside matching folders but not a similarly named file',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

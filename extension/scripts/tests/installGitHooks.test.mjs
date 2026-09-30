import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { installGitHooks, PRE_COMMIT_HOOK } from '../utils/installGitHooks.mjs'

const run = promisify(execFile)
const LOCAL_ENV = {}

/** Creates an owned Git repository with an `extension/` directory; cleanup belongs to the test context. @example const repository = await repositoryFixture(context) */
async function repositoryFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-git-hooks-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await run('git', ['init', '--quiet', directory])
  await mkdir(join(directory, 'extension'))
  return directory
}

/** Reads a repository config value, or `undefined` when it is unset. @example await readConfig(directory, 'core.hooksPath') */
async function readConfig(directory, key) {
  return run('git', ['config', '--get', key], { cwd: directory }).then(
    ({ stdout }) => stdout.trim(),
    () => undefined,
  )
}

test('installing the pre-commit hook keeps core.hooksPath unset so an existing pre-push guard still runs', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)
  const prePush = join(directory, '.git', 'hooks', 'pre-push')
  await writeFile(prePush, '#!/bin/sh\necho redaction guard\n')
  await chmod(prePush, 0o755)

  // Act
  const outcome = await installGitHooks({
    cwd: join(directory, 'extension'),
    env: LOCAL_ENV,
  })

  // Assert
  assert.equal(outcome, 'installed')
  assert.equal(await readConfig(directory, 'core.hooksPath'), undefined)
  assert.equal(
    await readFile(join(directory, '.git', 'hooks', 'pre-commit'), 'utf8'),
    PRE_COMMIT_HOOK,
  )
  assert.equal(
    await readFile(prePush, 'utf8'),
    '#!/bin/sh\necho redaction guard\n',
  )
})

test('installing from a linked worktree places the hook in the shared hooks directory', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)
  await run(
    'git',
    [
      '-c',
      'user.name=Codebook Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'base',
    ],
    { cwd: directory },
  )
  const worktree = join(directory, 'linked')
  await run('git', ['worktree', 'add', '--quiet', '--detach', worktree], {
    cwd: directory,
  })
  await mkdir(join(worktree, 'extension'))

  // Act
  const outcome = await installGitHooks({
    cwd: join(worktree, 'extension'),
    env: LOCAL_ENV,
  })

  // Assert
  assert.equal(outcome, 'installed')
  assert.equal(
    await readFile(join(directory, '.git', 'hooks', 'pre-commit'), 'utf8'),
    PRE_COMMIT_HOOK,
  )
})

test('a checkout without lint-staged installed still commits through the shared hook', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)
  await installGitHooks({ cwd: join(directory, 'extension'), env: LOCAL_ENV })
  await writeFile(join(directory, 'note.txt'), 'unformatted   text\n')
  await run('git', ['add', 'note.txt'], { cwd: directory })

  // Act
  await run(
    'git',
    [
      '-c',
      'user.name=Codebook Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'note',
    ],
    { cwd: directory },
  )

  // Assert
  const { stdout } = await run('git', ['show', 'HEAD:note.txt'], {
    cwd: directory,
  })
  assert.equal(stdout, 'unformatted   text\n')
})

test('another tool’s pre-commit hook is never replaced', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)
  const preCommit = join(directory, '.git', 'hooks', 'pre-commit')
  await writeFile(preCommit, '#!/bin/sh\necho learner hook\n')

  // Act
  const outcome = await installGitHooks({
    cwd: join(directory, 'extension'),
    env: LOCAL_ENV,
  })

  // Assert
  assert.equal(outcome, 'skipped-foreign-hook')
  assert.equal(
    await readFile(preCommit, 'utf8'),
    '#!/bin/sh\necho learner hook\n',
  )
})

test('a repository whose hooks another manager owns through core.hooksPath gets no hook', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)
  await run('git', ['config', 'core.hooksPath', '.managed-hooks'], {
    cwd: directory,
  })

  // Act
  const outcome = await installGitHooks({
    cwd: join(directory, 'extension'),
    env: LOCAL_ENV,
  })

  // Assert
  assert.equal(outcome, 'skipped-hooks-path')
  await assert.rejects(
    readFile(join(directory, '.git', 'hooks', 'pre-commit'), 'utf8'),
    { code: 'ENOENT' },
  )
})

test('CI installs no Git hook', async (context) => {
  // Arrange
  const directory = await repositoryFixture(context)

  // Act
  const outcome = await installGitHooks({
    cwd: join(directory, 'extension'),
    env: { CI: 'true' },
  })

  // Assert
  assert.equal(outcome, 'skipped-ci')
  await assert.rejects(
    readFile(join(directory, '.git', 'hooks', 'pre-commit'), 'utf8'),
    { code: 'ENOENT' },
  )
})

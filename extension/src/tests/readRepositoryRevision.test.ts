import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readRepositoryRevision } from '../utils/readRepositoryRevision'

/** Writes a stand-in `git` script that logs its arguments and the lock setting, then runs `body`. */
async function fakeGit(directory: string, body: string): Promise<string> {
  const path = join(directory, 'fake-git.sh')
  await writeFile(
    path,
    `#!/bin/sh\necho "$GIT_OPTIONAL_LOCKS $*" >> "${directory}/calls.log"\n${body}\n`,
  )
  await chmod(path, 0o755)
  return path
}

// protects=a slow Git costs a server history its revision (read as unknown and dirty), never the history's start; fails_when=the read waits for Git past its own bound; no_claim=the 2 s start bound
test('a revision read that Git answers too slowly returns an unknown dirty revision within its bound', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-revision-'))
  try {
    const command = await fakeGit(directory, 'sleep 5')
    const startedAt = Date.now()

    // Act
    const revision = await readRepositoryRevision(directory, {
      boundMs: 150,
      command,
    })

    // Assert
    assert.deepEqual(revision, { revision: 'unknown', dirty: true })
    // gstack-timing-ok: the bound is the contract (the fake Git sleeps 5 s; the read must give up at its own 150 ms bound, not wait for Git)
    assert.ok(Date.now() - startedAt < 3_000)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// protects=the revision read never takes Git's optional index lock, so a concurrent commit is not broken by the status; fails_when=status runs without --no-optional-locks or GIT_OPTIONAL_LOCKS=0; no_claim=a real Git
test('the revision read runs Git without optional locks', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-revision-'))
  try {
    const command = await fakeGit(directory, 'echo abc123')

    // Act
    const revision = await readRepositoryRevision(directory, { command })
    const calls = (await readFile(join(directory, 'calls.log'), 'utf8'))
      .trim()
      .split('\n')
      .sort()

    // Assert
    assert.deepEqual(revision, { revision: 'abc123', dirty: true })
    assert.deepEqual(calls, [
      '0 -c core.fsmonitor=false --no-optional-locks rev-parse HEAD',
      '0 -c core.fsmonitor=false --no-optional-locks status --porcelain --untracked-files=no',
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// protects=a repository's own core.fsmonitor hook never runs when the header's revision is read; fails_when=the status runs without core.fsmonitor=false; no_claim=other Git subcommands elsewhere in the product
test('the revision read does not start the repository fsmonitor hook and still returns the commit', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-revision-'))
  try {
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
    run('init', '-q')
    await writeFile(join(directory, 'tracked.txt'), 'one\n')
    run('add', 'tracked.txt')
    run(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      // The developer's global config (signing, a hooks directory) must not fail this setup commit; a hooks path that does not exist runs no hook on any OS.
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${join(directory, 'no-hooks')}`,
      'commit',
      '-q',
      '-m',
      'first',
    )
    const commit = run('rev-parse', 'HEAD')
    const marker = join(directory, 'fsmonitor-ran.marker')
    const hook = join(directory, 'hook.sh')
    await writeFile(hook, `#!/bin/sh\necho ran > "${marker}"\n`)
    await chmod(hook, 0o755)
    run('config', 'core.fsmonitor', hook)

    // Act
    const revision = await readRepositoryRevision(directory)

    // Assert
    assert.deepEqual(revision, { revision: commit, dirty: false })
    await assert.rejects(access(marker))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

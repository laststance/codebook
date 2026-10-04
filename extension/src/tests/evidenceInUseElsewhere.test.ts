import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { evidenceInUseElsewhere } from '../utils/evidenceInUseElsewhere'

/** Creates an agent storage with one other instance's run evidence, so a test only adds or leaves out that instance's connection descriptor. @example const agent = await agentStorage(context) */
async function agentStorage(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-evidence-in-use-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const evidenceDirectory = join(root, 'other-instance', 'run')
  await mkdir(evidenceDirectory, { recursive: true })
  return {
    evidenceDirectory,
    descriptor: join(root, 'other-instance.connection.json'),
  }
}

// Value: protects=the evidence of a window that is still running stays in place; fails_when=a descriptor that names a running process no longer keeps evidence; why_new=the descriptor now carries a process id; seam=none
test('the evidence of another window whose connection descriptor names a running process is in use elsewhere', async (context) => {
  // Arrange
  const agent = await agentStorage(context)
  await writeFile(agent.descriptor, JSON.stringify({ pid: process.pid }))
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
  )
  // Assert
  assert.equal(inUse, true)
})

// Value: protects=a descriptor left by a crashed window does not keep that instance's evidence in place forever; fails_when=only the descriptor's existence is checked (0039-F5); why_new=no test arranged a descriptor of an exited process; seam=a real exited process
test('the evidence of a window whose connection descriptor names an exited process moves with its study', async (context) => {
  // Arrange
  const agent = await agentStorage(context)
  const exited = spawnSync(process.execPath, ['-e', ''])
  await writeFile(agent.descriptor, JSON.stringify({ pid: exited.pid }))
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
  )
  // Assert
  assert.equal(inUse, false)
})

// Value: protects=a descriptor that cannot be inspected is not taken for an absent one; fails_when=an inspection failure counts as "no descriptor" (0039-F16) and evidence another window may use is moved; why_new=no test made the descriptor's inspection fail; seam=the inspection of the descriptor, which is refused
test('the evidence of a window whose connection descriptor cannot be inspected stays in use elsewhere', async (context) => {
  // Arrange
  const agent = await agentStorage(context)
  const lstatBefore = fsPromises.lstat
  context.mock.method(
    fsPromises,
    'lstat',
    async (...input: Parameters<typeof lstatBefore>) => {
      if (input[0] === agent.descriptor)
        throw Object.assign(new Error('EACCES: permission denied, lstat'), {
          code: 'EACCES',
        })
      return lstatBefore(...input)
    },
  )
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
  )
  context.mock.restoreAll()
  // Assert
  assert.equal(inUse, true)
})

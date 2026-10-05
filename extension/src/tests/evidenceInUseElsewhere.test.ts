import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
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
  await writeFile(
    agent.descriptor,
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
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
  await writeFile(
    agent.descriptor,
    JSON.stringify({ pid: exited.pid, hostname: hostname() }),
  )
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

// Value: protects=the evidence of a window that runs on another machine sharing this storage is never moved to the Trash under it; fails_when=the descriptor's owner is judged by its process id alone, which names no process, or another process, on this machine (Cycle 0044 row C-L1); why_new=every descriptor test named a process of this machine; seam=the injected machine identity and the process probe
test('the evidence of a window on another machine stays in use elsewhere although its process id does not exist here', async (context) => {
  // Arrange: the descriptor of process 4242 on another machine; no process 4242 runs on this one, and the boots differ.
  const agent = await agentStorage(context)
  await writeFile(
    agent.descriptor,
    '{"pid":4242,"hostname":"another-machine","machineId":"machine-b","boot":{"id":"boot-of-machine-b"}}',
  )
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
  })
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      boot: { id: 'boot-of-machine-a' },
    },
  )
  // Assert
  assert.equal(inUse, true)
})

// Value: protects=a descriptor a crashed window left before the machine restarted does not keep its evidence in place because another process got its id; fails_when=the descriptor's owner is judged by its process id alone; why_new=the descriptor records its boot since Cycle 0045 (engineering review ER-20); seam=the injected boot identity and the process probe
test('the evidence of a window that crashed before the last restart moves with its study although its process id is in use again', async (context) => {
  // Arrange: the descriptor of process 4242 of this machine, written under the boot before the restart; a process with id 4242 runs again.
  const agent = await agentStorage(context)
  await writeFile(
    agent.descriptor,
    '{"pid":4242,"hostname":"workstation","machineId":"machine-a","boot":{"id":"boot-before-the-restart"}}',
  )
  context.mock.method(process, 'kill', (): true => true)
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      boot: { id: 'boot-after-the-restart' },
    },
  )
  // Assert
  assert.equal(inUse, false)
})

// Value: protects=the evidence of a running window is never moved to the Trash because the clock was corrected while the window ran; fails_when=a descriptor, which lives as long as its window, is judged by a boot time, so a correction of more than the tolerance makes its owner one of an earlier boot; why_new=the descriptor records its boot since Cycle 0045; seam=the injected boot identity and the process probe
test('the evidence of a running window stays in use elsewhere although the boot time its descriptor recorded lies before the one computed now', async (context) => {
  // Arrange: the descriptor of running process 4242 of this machine, written before the clock was set forward by 90 s.
  const agent = await agentStorage(context)
  await writeFile(
    agent.descriptor,
    '{"pid":4242,"hostname":"workstation","boot":{"startedAtMs":1790000000000}}',
  )
  context.mock.method(process, 'kill', (): true => true)
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
    { hostname: 'workstation', boot: { startedAtMs: 1_790_000_090_000 } },
  )
  // Assert
  assert.equal(inUse, true)
})

// Value: protects=a descriptor of an earlier build, which names a process id and no machine, is never taken for one of this machine; fails_when=a missing host counts as this machine, so on shared storage a running window's evidence is moved; why_new=the machine is judged since Cycle 0045; seam=a real exited process
test('the evidence of a window whose connection descriptor names a process and no machine stays in use elsewhere', async (context) => {
  // Arrange: a descriptor as an earlier build wrote it, with a process id that no longer exists on this machine.
  const agent = await agentStorage(context)
  const exited = spawnSync(process.execPath, ['-e', ''])
  await writeFile(agent.descriptor, JSON.stringify({ pid: exited.pid }))
  // Act
  const inUse = await evidenceInUseElsewhere(
    agent.evidenceDirectory,
    'own-instance',
  )
  // Assert
  assert.equal(inUse, true)
})

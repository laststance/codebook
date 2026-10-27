import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeServerMachineGaps } from '../utils/nodeServerMachineGaps'

const everyProgram = async () => true
const noProgram = async () => false

// protects=D8: a machine with a listener tool and ps reads ready; fails_when=a supported machine is reported with a gap; no_claim=the real file system (paths are the real ones in the environment test)
test('a macOS machine with lsof and ps has no node-server gap', async () => {
  // Arrange / Act
  const gaps = await nodeServerMachineGaps({
    platform: 'darwin',
    isProgramFile: everyProgram,
  })
  // Assert
  assert.deepEqual(gaps, [])
})

// protects=D8: native Windows reads not ready with its own sentence only, since neither tool exists there; fails_when=Windows is offered the profile or reports tool sentences that cannot be fixed; no_claim=WSL (a Linux host)
test('native Windows reads not ready with one sentence', async () => {
  // Arrange / Act
  const gaps = await nodeServerMachineGaps({
    platform: 'win32',
    isProgramFile: everyProgram,
  })
  // Assert
  assert.deepEqual(gaps, [
    'node-server needs macOS, Linux or WSL; native Windows is not supported yet.',
  ])
})

// protects=D8: each missing machine item is named: the listener tool with where it must lie, and ps; fails_when=a missing item is unnamed or the install hint is gone; no_claim=none
test('a machine without a listener tool and without ps names both', async () => {
  // Arrange / Act
  const gaps = await nodeServerMachineGaps({
    platform: 'linux',
    isProgramFile: noProgram,
  })
  // Assert
  assert.equal(gaps.length, 2)
  assert.match(
    gaps[0]!,
    /^node-server needs lsof \(macOS or Linux, at \/usr\/sbin\/lsof or \/usr\/bin\/lsof\) or ss \(Linux, at \/usr\/bin\/ss/,
  )
  assert.match(
    gaps[0]!,
    /Ask the learner to install one, then call codebook_status again\.$/,
  )
  assert.equal(
    gaps[1],
    'node-server needs ps at /bin/ps or /usr/bin/ps to check that the listener is the process it started.',
  )
})

// protects=D8: Linux accepts ss when lsof is absent; fails_when=a Linux machine with only ss reads not ready; no_claim=none
test('a Linux machine with only ss and ps has no node-server gap', async () => {
  // Arrange
  const onlySs = async (path: string) =>
    path === '/usr/bin/ss' || path === '/bin/ps'
  // Act
  const gaps = await nodeServerMachineGaps({
    platform: 'linux',
    isProgramFile: onlySs,
  })
  // Assert
  assert.deepEqual(gaps, [])
})

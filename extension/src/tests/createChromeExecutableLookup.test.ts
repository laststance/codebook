import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createChromeExecutableLookup } from '../utils/createChromeExecutableLookup'

/**
 * Stands in for the caller's filesystem check over a set of installed executables a test may change, and keeps every path asked about in order.
 * @param installed - The executable paths of this imagined machine; the test adds to it or removes from it between lookups.
 * @returns The check to pass as `isExecutable` and the paths it was asked about so far.
 * @example
 * const machine = machineWith(new Set(['/usr/bin/chromium'])); await machine.isExecutable('/usr/bin/chromium') // => true, machine.probed => ['/usr/bin/chromium']
 */
function machineWith(installed: Set<string>) {
  const probed: string[] = []
  return {
    probed,
    isExecutable: async (path: string): Promise<boolean> => {
      probed.push(path)
      return installed.has(path)
    },
  }
}

test('no Chrome on PATH is answered again without a probe for ten seconds, and a browser installed meanwhile is found by the first lookup after them', async () => {
  // Arrange
  let nowMs = 0
  const installed = new Set<string>(),
    machine = machineWith(installed)
  const lookUpChromeExecutable = createChromeExecutableLookup(() => nowMs)
  const first = await lookUpChromeExecutable(
    '',
    'linux',
    '/usr/bin',
    machine.isExecutable,
  )
  const probedByFirstLookup = machine.probed.splice(0)
  installed.add('/usr/bin/chromium')
  // Act
  nowMs = 9_999
  const withinTheBound = await lookUpChromeExecutable(
    '',
    'linux',
    '/usr/bin',
    machine.isExecutable,
  )
  const probedWithinTheBound = machine.probed.splice(0)
  nowMs = 10_000
  const afterTheBound = await lookUpChromeExecutable(
    '',
    'linux',
    '/usr/bin',
    machine.isExecutable,
  )
  // Assert
  assert.equal(first, undefined)
  assert.deepEqual(probedByFirstLookup, [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ])
  assert.equal(withinTheBound, undefined)
  assert.deepEqual(probedWithinTheBound, [])
  assert.equal(afterTheBound, '/usr/bin/chromium')
})

test('a PATH that changed is searched at once, although no Chrome was found on the earlier one a moment before', async () => {
  // Arrange
  const machine = machineWith(new Set(['/opt/chrome/google-chrome']))
  const lookUpChromeExecutable = createChromeExecutableLookup(() => 0)
  await lookUpChromeExecutable('', 'linux', '/usr/bin', machine.isExecutable)
  // Act
  const onTheNewPath = await lookUpChromeExecutable(
    '',
    'linux',
    '/usr/bin:/opt/chrome',
    machine.isExecutable,
  )
  // Assert
  assert.equal(onTheNewPath, '/opt/chrome/google-chrome')
})

test('a configured executable is answered without a probe, however often it is asked', async () => {
  // Arrange
  const machine = machineWith(new Set())
  const lookUpChromeExecutable = createChromeExecutableLookup(() => 0)
  // Act
  const first = await lookUpChromeExecutable(
    '/opt/chrome/chrome',
    'linux',
    '/usr/bin',
    machine.isExecutable,
  )
  const second = await lookUpChromeExecutable(
    '/opt/chrome/chrome',
    'linux',
    '/usr/bin',
    machine.isExecutable,
  )
  // Assert
  assert.equal(first, '/opt/chrome/chrome')
  assert.equal(second, '/opt/chrome/chrome')
  assert.deepEqual(machine.probed, [])
})

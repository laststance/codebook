import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

/**
 * Stands in for the caller's filesystem check: only the listed paths are executable, and every path asked about is kept in order.
 * @param installed - The executable paths of this imagined machine.
 * @returns The check to pass as `isExecutable` and the paths it was asked about so far.
 * @example
 * const machine = machineWith(['/usr/bin/chromium']); await machine.isExecutable('/usr/bin/chromium') // => true, machine.probed => ['/usr/bin/chromium']
 */
function machineWith(installed: string[]) {
  const probed: string[] = []
  return {
    probed,
    isExecutable: async (path: string): Promise<boolean> => {
      probed.push(path)
      return installed.includes(path)
    },
  }
}

test('with Chromium earlier on PATH than Google Chrome, an unset setting chooses Google Chrome', async () => {
  // Arrange
  const machine = machineWith(['/snap/bin/chromium', '/usr/bin/google-chrome'])
  // Act
  const executable = await resolveChromeExecutable(
    '',
    'linux',
    '/snap/bin:/usr/bin',
    machine.isExecutable,
  )
  // Assert
  assert.equal(executable, '/usr/bin/google-chrome')
})

test('a later name is found when the first is installed nowhere', async () => {
  // Arrange
  const machine = machineWith(['/usr/bin/chromium-browser'])
  // Act
  const executable = await resolveChromeExecutable(
    '',
    'linux',
    '/usr/local/bin:/usr/bin',
    machine.isExecutable,
  )
  // Assert
  assert.equal(executable, '/usr/bin/chromium-browser')
})

test('empty PATH segments are skipped', async () => {
  // Arrange: an executable named like Chrome lies in the working directory, where an empty segment would look.
  const machine = machineWith(['google-chrome'])
  // Act
  const executable = await resolveChromeExecutable(
    '',
    'linux',
    ':/usr/bin::/opt/bin:',
    machine.isExecutable,
  )
  // Assert
  assert.equal(executable, undefined)
  assert.deepEqual(machine.probed, [
    '/usr/bin/google-chrome',
    '/opt/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/opt/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/bin/chromium-browser',
  ])
})

test('an unset setting names no Chrome on Windows and the application path on macOS, and a configured value is kept on every platform', async () => {
  // Arrange: a machine where every path asked about is executable, so a search would always find something.
  const probed: string[] = []
  const isExecutable = async (path: string): Promise<boolean> => {
    probed.push(path)
    return true
  }
  // Act
  const onWindows = await resolveChromeExecutable(
    '',
    'win32',
    '/usr/bin',
    isExecutable,
  )
  const onMacOS = await resolveChromeExecutable(
    '',
    'darwin',
    '/usr/bin',
    isExecutable,
  )
  const configured = await Promise.all(
    (['linux', 'darwin', 'win32'] as const).map((platform) =>
      resolveChromeExecutable(
        '/opt/chrome/chrome',
        platform,
        '/usr/bin',
        isExecutable,
      ),
    ),
  )
  // Assert
  assert.equal(onWindows, undefined)
  assert.equal(
    onMacOS,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  )
  assert.deepEqual(configured, [
    '/opt/chrome/chrome',
    '/opt/chrome/chrome',
    '/opt/chrome/chrome',
  ])
  assert.deepEqual(probed, [])
})

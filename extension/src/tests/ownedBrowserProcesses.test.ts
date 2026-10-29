import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ownedBrowserProcesses } from '../runtimeSupport/utils/ownedBrowserProcesses'

// A real folder, so the proof resolves it as the sweep does (macOS /var resolves to /private/var).
const root = mkdtempSync(join(tmpdir(), 'codebook-owned-browser-proof-'))
mkdirSync(join(root, 'codebook-browser-a'))
const PROFILE = realpathSync(join(root, 'codebook-browser-a'))
const EXECUTABLE = '/opt/chrome/chrome'

// protects=the orphan sweep signals only the browser Codebook spawned (exact executable and exact --user-data-dir) on macOS text listings; fails_when=a process merely printing the folder, or a switch after a "--" terminator, is proven; why_new=removeOrphanBrowser.test.ts drives the sweep, not the per-platform proof table; seam=none; no_claim=real ps output (hand-written listings)
test('macOS proof keeps only the recorded executable with the exact profile switch before any terminator', async () => {
  // Arrange
  const listing = [
    { pid: 11, command: `${EXECUTABLE} --user-data-dir=${PROFILE} --headless` },
    { pid: 12, command: `${EXECUTABLE} -- --user-data-dir=${PROFILE}` },
    { pid: 13, command: `/usr/bin/vim --user-data-dir=${PROFILE}` },
    { pid: 14, command: `${EXECUTABLE}-beta --user-data-dir=${PROFILE}` },
    { pid: 15, command: `${EXECUTABLE} --user-data-dir=${PROFILE}-other` },
  ]

  // Act
  const proven = await ownedBrowserProcesses(PROFILE, EXECUTABLE, listing, {
    platform: 'darwin',
  })

  // Assert
  assert.deepEqual(
    proven.map(({ pid }) => pid),
    [11],
  )
})

// protects=on Linux a process is proven only by its exact argv: same program, same folder, and the listed text still equal to the arguments; fails_when=a reused pid, a different program or an unreadable /proc entry is proven; why_new=no existing test reaches the Linux branch of the proof; seam=none; no_claim=real /proc (readArguments is injected)
test('Linux proof rejects a reused pid, another program and unreadable arguments', async () => {
  // Arrange
  const listing = [
    { pid: 21, command: `${EXECUTABLE} --user-data-dir=${PROFILE}` },
    { pid: 22, command: `${EXECUTABLE} --user-data-dir=${PROFILE}` },
    { pid: 23, command: `/usr/bin/vim --user-data-dir=${PROFILE}` },
    { pid: 24, command: `${EXECUTABLE} --user-data-dir=${PROFILE}` },
    { pid: 25, command: `${EXECUTABLE} --user-data-dir=${PROFILE}/` },
    { pid: 26, command: `${EXECUTABLE} --user-data-dir=` },
  ]
  const argumentsOf: Record<number, string[] | undefined> = {
    21: [EXECUTABLE, `--user-data-dir=${PROFILE}`],
    22: ['/usr/bin/other', '--flag'],
    23: ['/usr/bin/vim', `--user-data-dir=${PROFILE}`],
    24: undefined,
    25: [EXECUTABLE, `--user-data-dir=${PROFILE}/`],
    26: [EXECUTABLE, '--user-data-dir='],
  }

  // Act
  const proven = await ownedBrowserProcesses(PROFILE, EXECUTABLE, listing, {
    platform: 'linux',
    readArguments: async (pid) => argumentsOf[pid],
  })

  // Assert
  assert.deepEqual(
    proven.map(({ pid }) => pid),
    [21, 25],
  )
})

// protects=on Windows the program is compared as Windows compares paths and the profile switch must name the folder; fails_when=another program or another folder is proven, or a case-different path is refused; why_new=no existing test reaches the Windows branch of the proof; seam=none; no_claim=real Windows command lines (hand-written)
test('Windows proof accepts a case-different executable path and rejects another folder', async () => {
  // Arrange
  const windowsProfile = PROFILE
  const windowsExecutable = 'C:\\Chrome\\chrome.exe'
  const listing = [
    {
      pid: 31,
      command: `"c:/chrome/CHROME.exe" --user-data-dir=${windowsProfile}`,
    },
    {
      pid: 32,
      command: `"C:\\Other\\notepad.exe" --user-data-dir=${windowsProfile}`,
    },
    {
      pid: 33,
      command: `"${windowsExecutable}" --user-data-dir=C:\\elsewhere`,
    },
  ]

  // Act
  const proven = await ownedBrowserProcesses(
    windowsProfile,
    windowsExecutable,
    listing,
    { platform: 'win32' },
  )

  // Assert
  assert.deepEqual(
    proven.map(({ pid }) => pid),
    [31],
  )
})

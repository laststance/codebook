import assert from 'node:assert/strict'
import { win32 } from 'node:path'
import { test } from 'node:test'

import { managedProfileRoot } from '../runtimeSupport/utils/managedProfileRoot'

// Value: protects=where the managed browser profiles of each system live: on Windows, which has no user id to judge another user's folder by, below the user's own local application data folder (LOCALAPPDATA, else the home folder's AppData\Local), never TEMP, which an administrator may point at a folder several users share; the shared, short /tmp on macOS and Linux, where the sweep compares the folder's owner; fails_when=Windows uses `<drive>:\tmp` or TEMP (a shared D:\Temp lets one user's sweep remove another user's live profile), a missing or relative LOCALAPPDATA gives no folder of the user's own, or macOS and Linux lose the fixed /tmp that Chrome and the debugger resolve (SC3, Cycle 0046 repeat review; CX7, /ship Codex adversarial review); why_new=the Windows root was TEMP; seam=the system, the environment, the home folder and the Windows path functions the function is given
test('managed browser profiles live below the user’s local application data folder on Windows, never in TEMP, and in /tmp on macOS and Linux', () => {
  // Arrange: TEMP names a folder several users share; it is not read.
  const homeDirectory = (): string => 'C:\\Users\\a b'
  const withLocalAppData = {
    LOCALAPPDATA: 'C:\\Users\\a b\\AppData\\Local',
    TEMP: 'D:\\Temp',
  }
  const withoutLocalAppData: { LOCALAPPDATA?: string; TEMP: string } = {
    TEMP: 'D:\\Temp',
  }
  const withRelativeLocalAppData = {
    LOCALAPPDATA: 'AppData\\Local',
    TEMP: 'D:\\Temp',
  }
  // Act
  const roots = {
    windows: managedProfileRoot('win32', {
      environment: withLocalAppData,
      homeDirectory,
      paths: win32,
    }),
    windowsWithoutLocalAppData: managedProfileRoot('win32', {
      environment: withoutLocalAppData,
      homeDirectory,
      paths: win32,
    }),
    windowsWithRelativeLocalAppData: managedProfileRoot('win32', {
      environment: withRelativeLocalAppData,
      homeDirectory,
      paths: win32,
    }),
    macOS: managedProfileRoot('darwin', {
      environment: withLocalAppData,
      homeDirectory,
    }),
    linux: managedProfileRoot('linux', {
      environment: withLocalAppData,
      homeDirectory,
    }),
  }
  // Assert
  assert.deepEqual(roots, {
    windows: 'C:\\Users\\a b\\AppData\\Local\\Codebook\\browser-profiles',
    windowsWithoutLocalAppData:
      'C:\\Users\\a b\\AppData\\Local\\Codebook\\browser-profiles',
    windowsWithRelativeLocalAppData:
      'C:\\Users\\a b\\AppData\\Local\\Codebook\\browser-profiles',
    macOS: '/tmp',
    linux: '/tmp',
  })
})

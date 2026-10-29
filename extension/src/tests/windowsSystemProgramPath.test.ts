import assert from 'node:assert/strict'
import { test } from 'node:test'

import { windowsSystemProgramPath } from '../utils/windowsSystemProgramPath'

// Value: protects=the owned browser's taskkill starts only System32's own program (local CodeRabbit, Cycle 0061 pt1): a bare `taskkill` is looked up in the current folder first, where a repository could hold its own taskkill.exe; fails_when=a taskkill path is given for a root on the current drive or a network share, or none is given for a system root on a drive letter read from SystemRoot or windir; no_claim=that the spawned program ends the tree (the Windows job's orphan-sweep test)
test('taskkill is named by its full path under a system root on a drive named by its letter, from SystemRoot or windir, and not at all under a root on the current drive or a network share', () => {
  // Act
  const programs = {
    systemRoot: windowsSystemProgramPath(['System32', 'taskkill.exe'], {
      SystemRoot: 'C:\\Windows',
    }),
    windirInCapitals: windowsSystemProgramPath(['System32', 'taskkill.exe'], {
      WINDIR: 'D:\\WINNT',
    }),
    rootOnTheCurrentDrive: windowsSystemProgramPath(
      ['System32', 'taskkill.exe'],
      { SystemRoot: '\\Windows' },
    ),
    rootOnANetworkShare: windowsSystemProgramPath(
      ['System32', 'taskkill.exe'],
      { SystemRoot: '\\\\server\\share\\Windows' },
    ),
    noRoot: windowsSystemProgramPath(['System32', 'taskkill.exe'], {}),
  }
  // Assert
  assert.deepEqual(programs, {
    systemRoot: 'C:\\Windows\\System32\\taskkill.exe',
    windirInCapitals: 'D:\\WINNT\\System32\\taskkill.exe',
    rootOnTheCurrentDrive: undefined,
    rootOnANetworkShare: undefined,
    noRoot: undefined,
  })
})

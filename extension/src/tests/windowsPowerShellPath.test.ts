import assert from 'node:assert/strict'
import { test } from 'node:test'

import { windowsPowerShellPath } from '../utils/windowsPowerShellPath'

// Value: protects=the one program the Windows process listing and start query start: PowerShell from a system root on a drive named by its letter, read from SystemRoot or windir in any case of their names, and no program at all for a root rooted on the current drive, relative to a drive's current folder, or on a network share, while a root written with `/` is the same folder (AD15 with CX8, /ship adversarial review; TT13, the third testing review); fails_when=`\Windows` is taken (it resolves on whatever drive is current), `C:Windows` is taken (it resolves against drive C's current folder), `C:/Windows` is refused, a `\\server\share` root is taken (another machine's program would run with the user's rights), or a name written `SYSTEMROOT` in a plain environment object is not read, so the query is refused although the root is known; why_new=the root was accepted by path.win32.isAbsolute and read by its exact name; seam=the environment the function is given
test('PowerShell is named only under a system root on a drive named by its letter, read from SystemRoot or windir in any case, and not under a root on the current drive, relative to a drive’s current folder, or on a network share', () => {
  // Act
  const programs = {
    systemRoot: windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }),
    systemRootInCapitals: windowsPowerShellPath({ SYSTEMROOT: 'C:\\Windows' }),
    windirInCapitals: windowsPowerShellPath({ WINDIR: 'D:\\WINNT' }),
    rootOnTheCurrentDrive: windowsPowerShellPath({ SystemRoot: '\\Windows' }),
    rootOnANetworkShare: windowsPowerShellPath({
      SystemRoot: '\\\\server\\share\\Windows',
    }),
    rootRelativeToADrivesCurrentFolder: windowsPowerShellPath({
      SystemRoot: 'C:Windows',
    }),
    rootWrittenWithForwardSlashes: windowsPowerShellPath({
      SystemRoot: 'C:/Windows',
    }),
    rootOnTheCurrentDriveWithWindir: windowsPowerShellPath({
      SystemRoot: '\\Windows',
      windir: 'C:\\Windows',
    }),
    noRoot: windowsPowerShellPath({}),
  }
  // Assert
  assert.deepEqual(programs, {
    systemRoot:
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    systemRootInCapitals:
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    windirInCapitals:
      'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    rootOnTheCurrentDrive: undefined,
    rootOnANetworkShare: undefined,
    rootRelativeToADrivesCurrentFolder: undefined,
    rootWrittenWithForwardSlashes:
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    rootOnTheCurrentDriveWithWindir:
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    noRoot: undefined,
  })
})

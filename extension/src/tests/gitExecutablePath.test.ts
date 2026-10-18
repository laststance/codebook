import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gitExecutablePath } from '../utils/gitExecutablePath'

/**
 * Builds a program check of a test's own: the paths that hold a program, and every path the lookup asked about.
 * @param programs - The paths that hold a program.
 * @returns `isProgramFile` for {@link gitExecutablePath} and `asked`, every path it was asked about, in order.
 * @example
 * const files = programFiles(['/usr/bin/git']) // files.asked => ['/usr/local/bin/git', '/usr/bin/git'] after a lookup
 */
function programFiles(programs: string[]): {
  isProgramFile: (path: string) => Promise<boolean>
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    isProgramFile: async (path) => {
      asked.push(path)
      return programs.includes(path)
    },
  }
}

// Value: protects=the learner's rights when a cloned repository carries a git.exe or git.com at its root: on Windows, where a bare program name is looked up in the spawn's current folder (the opened project) before PATH, Git is found by an absolute path from PATH alone, and neither a relative or empty PATH entry nor the current folder is ever looked in; the PATHEXT names Node.js starts without a shell are tried in order, a name in any case is read (SX2, Cycle 0046 repeat security review); fails_when=a relative entry (`.`, `tools`) or an empty one is looked in, a folder rooted on the current drive (`\bin`) or relative to a drive's current folder (`C:tools`, which spawn resolves against the project's folder when C is its drive) is taken, a batch file is taken, or Git is not found in an absolute PATH folder; why_new=Git was started by its bare name with the project as its folder; seam=the platform, the environment and the program check the lookup is given
test('on Windows Git is found by an absolute path from PATH alone, and no relative, empty or current-drive entry is ever looked in', async () => {
  // Arrange: the project holds a git.exe; PATH names the current folder, a relative folder, an empty entry, a folder on the current drive, a folder relative to drive C's current folder and Git's own folder in quotes.
  const files = programFiles([
    'C:\\project\\git.exe',
    'tools\\git.exe',
    '\\bin\\git.exe',
    'C:tools\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
  ])
  // Act
  const found = await gitExecutablePath({
    platform: 'win32',
    environment: {
      Path: '.;tools;;\\bin;C:tools;"C:\\Program Files\\Git\\cmd";C:\\Windows',
      PATHEXT: '.BAT;.COM;.EXE;.CMD',
    },
    isProgramFile: files.isProgramFile,
  })
  // Assert
  assert.deepEqual(
    { found, asked: files.asked },
    {
      found: 'C:\\Program Files\\Git\\cmd\\git.exe',
      asked: [
        'C:\\Program Files\\Git\\cmd\\git.com',
        'C:\\Program Files\\Git\\cmd\\git.exe',
      ],
    },
  )
})

// Value: protects=Git on a Windows machine whose PATH names a folder of a network share, and whose environment sets no PATHEXT: a UNC folder is absolute and is looked in, and without PATHEXT the extensions Windows takes by default are read, of which .com and .exe start without a shell (SX2; TT14, the third testing review); fails_when=a UNC folder is skipped as not absolute, so Git there reads as missing, or a missing PATHEXT gives no extension, so no Git is ever found; why_new=every Windows row named a drive folder and set PATHEXT; seam=the platform, the environment and the program check the lookup is given
test('on Windows Git is found in a folder of a network share, and without PATHEXT the default extensions that start without a shell are tried', async () => {
  // Arrange
  const files = programFiles(['\\\\server\\share\\Git\\cmd\\git.exe'])
  // Act
  const found = await gitExecutablePath({
    platform: 'win32',
    environment: { Path: '\\\\server\\share\\Git\\cmd' },
    isProgramFile: files.isProgramFile,
  })
  // Assert
  assert.deepEqual(
    { found, asked: files.asked },
    {
      found: '\\\\server\\share\\Git\\cmd\\git.exe',
      asked: [
        '\\\\server\\share\\Git\\cmd\\git.com',
        '\\\\server\\share\\Git\\cmd\\git.exe',
      ],
    },
  )
})

// Value: protects=the same rule on macOS and Linux, which do not look up a bare name in the current folder, so every Git command starts one absolute path: an empty PATH entry (the current folder) and a relative one are skipped, and PATH is read by its exact name, as these systems name variables (SX2, Cycle 0046 repeat security review; TT18, the third testing review); fails_when=an empty or relative entry is looked in, so a `git` in the project runs, or another variable whose name differs only in case (`path`) is read in PATH's place; why_new=Git was started by its bare name; seam=the platform, the environment and the program check the lookup is given
test('on macOS and Linux Git is found by an absolute path from PATH, and an empty or relative entry is skipped', async () => {
  // Arrange: a variable `path` beside PATH names a folder that holds a git, which is another variable on these systems.
  const files = programFiles([
    'git',
    'bin/git',
    '/elsewhere/git',
    '/usr/bin/git',
  ])
  // Act
  const found = await gitExecutablePath({
    platform: 'linux',
    environment: { path: '/elsewhere', PATH: ':bin:/usr/local/bin:/usr/bin' },
    isProgramFile: files.isProgramFile,
  })
  // Assert
  assert.deepEqual(
    { found, asked: files.asked },
    {
      found: '/usr/bin/git',
      asked: ['/usr/local/bin/git', '/usr/bin/git'],
    },
  )
})

// Value: protects=the answer every caller gives for a machine without Git: the lookup fails as a Git that cannot be started fails (ENOENT, "spawn git ENOENT"), so the Wiki's freshness reads "Git missing" and source discovery names Git as a missing prerequisite, as before (SX2, Cycle 0046 repeat security review); fails_when=a missing Git answers another error, or a Git in the project folder is taken when PATH holds none; why_new=the lookup is new; seam=the platform, the environment and the program check the lookup is given
test('a machine whose PATH holds no Git gets the error of a Git that cannot be started', async () => {
  // Arrange: only the project holds a git.
  const files = programFiles(['git.exe', 'C:\\project\\git.exe'])
  // Act
  const failure: unknown = await gitExecutablePath({
    platform: 'win32',
    environment: { PATH: 'C:\\Windows' },
    isProgramFile: files.isProgramFile,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof Error)
  assert.deepEqual(
    {
      message: failure.message,
      code: 'code' in failure ? failure.code : undefined,
    },
    { message: 'spawn git ENOENT', code: 'ENOENT' },
  )
})

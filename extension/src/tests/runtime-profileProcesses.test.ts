import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { profileProcesses } from '../runtimeSupport/utils/profileProcesses'
import { windowsCommandLineArguments } from '../runtimeSupport/utils/windowsCommandLineArguments'

test('a symlinked profile observes its canonical process and excludes a prefix-sharing profile', async () => {
  // Arrange: reproduce macOS /tmp -> /private/tmp normalization with an explicit portable symlink.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-process-test-'))
  const profile = await realpath(directory)
  const alias = `${directory}-alias`
  await symlink(profile, alias)
  const owned = spawn(process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
    '--',
    `--user-data-dir=${profile}`,
  ])
  const unrelated = spawn(process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
    '--',
    `--user-data-dir=${profile}-other`,
  ])
  try {
    await Promise.all([once(owned, 'spawn'), once(unrelated, 'spawn')])
    // Act
    const observed = await profileProcesses(alias)
    // Assert
    assert.equal(
      observed.some((process) => process.pid === owned.pid),
      true,
    )
    assert.equal(
      observed.some((process) => process.pid === unrelated.pid),
      false,
    )
    const exited = once(owned, 'exit')
    owned.kill()
    await exited
    assert.deepEqual(await profileProcesses(alias), [])
  } finally {
    owned.kill()
    const exited = once(unrelated, 'exit')
    unrelated.kill()
    await exited
    await rm(alias)
    await rm(directory, { recursive: true })
  }
})

// Value: protects=the Chrome a managed run owns on Windows when the temp folder's path holds a space (a user name with a space): Windows keeps that argument in quotes, around the whole argument or around its value, and the profile is still matched, so attachViewport finds the owned process and the close sees it exit, while a profile whose path only starts with this one's is not matched; fails_when=the argument is found in the command line's text and must end at a space or the line's end, so the closing quote leaves the owned Chrome out (CX2, hosted Codex review of PR #88, profileProcesses.ts:26); why_new=every profile test named a path without a space, unquoted; seam=the system the command lines are read for (`win32`) and a listing of the test's own, matched against a real profile folder whose path holds a space
test('on Windows a profile whose path holds a space is matched in both quoted forms of its argument, and a profile whose path only starts with it is not', async (context) => {
  // Arrange: a real profile folder below a folder whose name holds a space, and the command lines Windows keeps for Chrome processes.
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook profile ')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const chrome = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
  const listing = [
    {
      pid: 11,
      command: `${chrome} "--user-data-dir=${profile}" --remote-debugging-pipe`,
    },
    {
      pid: 12,
      command: `${chrome} --type=renderer --user-data-dir="${profile}" --lang=en-US`,
    },
    { pid: 13, command: `${chrome} "--user-data-dir=${profile}-other"` },
  ]
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(
    observed.map((listed) => listed.pid),
    [11, 12],
  )
})

// Value: protects=the arguments a Windows command line holds as Chrome receives them, by which a profile is matched on Windows: quoted parts, doubled quotes and backslashes before quotes are read by the rules of the Microsoft C runtime, and a backslash elsewhere stays a character of a path; fails_when=a quote ends or splits an argument where Windows does not, or a path loses a backslash, so a profile is matched wrongly (CX2, hosted Codex review of PR #88); why_new=the splitter is new; seam=none
test('a Windows command line splits into the arguments a program receives, by its quotes and the backslashes before them', () => {
  // Arrange
  const commandLines = {
    quotedProgramAndArgument:
      '"C:\\Program Files\\chrome.exe" "--user-data-dir=C:\\Users\\a b\\x" --headless',
    quotedValue: 'chrome.exe  --user-data-dir="C:\\Users\\a b\\x"\t--lang=en',
    backslashesBeforeQuotes: 'tool.exe a\\\\"b c" d\\"e "f\\\\" g\\h',
    doubledQuoteInQuotes: 'tool.exe "say ""hi""" ""',
    separatorsOnly: ' \t ',
  }
  // Act
  const split = Object.fromEntries(
    Object.entries(commandLines).map(([name, commandLine]) => [
      name,
      windowsCommandLineArguments(commandLine),
    ]),
  )
  // Assert
  assert.deepEqual(split, {
    quotedProgramAndArgument: [
      'C:\\Program Files\\chrome.exe',
      '--user-data-dir=C:\\Users\\a b\\x',
      '--headless',
    ],
    quotedValue: [
      'chrome.exe',
      '--user-data-dir=C:\\Users\\a b\\x',
      '--lang=en',
    ],
    backslashesBeforeQuotes: ['tool.exe', 'a\\b c', 'd"e', 'f\\', 'g\\h'],
    doubledQuoteInQuotes: ['tool.exe', 'say "hi"', ''],
    separatorsOnly: [],
  })
})

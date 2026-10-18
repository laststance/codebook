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

// Value: protects=the arguments a Windows command line holds as Chrome receives them, by which a profile is matched on Windows: Chrome reads its command line with CommandLineToArgvW, whose program name ends at its closing quote or at the first white space, and whose quoted parts, runs of quotes and backslashes before quotes follow its own rules (the inputs of the /ship adversarial review's probe, AD14); a backslash elsewhere stays a character of a path; fails_when=the splitter follows the C runtime's rules where they differ, so `"C:\P F\chrome.exe"--user-data-dir=X` hides the switch inside the program name, a doubled or tripled quote joins two arguments, or a path loses a backslash (CX2; AD14, /ship adversarial review Step 11); why_new=the splitter followed the C runtime; seam=none (expected values checked against the reviewer's port of Wine's CommandLineToArgvW)
test('a Windows command line splits into the arguments Chrome receives, as CommandLineToArgvW splits it', () => {
  // Arrange
  const commandLines = {
    quotedProgramAndArgument:
      '"C:\\Program Files\\chrome.exe" "--user-data-dir=C:\\Users\\a b\\x" --headless',
    quotedValue: 'chrome.exe  --user-data-dir="C:\\Users\\a b\\x"\t--lang=en',
    backslashesBeforeQuotes: 'tool.exe a\\\\"b c" d\\"e "f\\\\" g\\h',
    doubledQuoteInQuotes: 'tool.exe "say ""hi""" ""',
    separatorsOnly: ' \t ',
    programNameClosesAtItsQuote:
      '"C:\\P F\\chrome.exe"--user-data-dir=C:\\T\\codebook-browser-1',
    doubledQuoteThenSpaceInQuotes:
      'chrome.exe "a""b --user-data-dir=C:\\T\\codebook-browser-1"',
    tripleQuoteOutsideQuotes:
      'chrome.exe """ --user-data-dir=C:\\T\\codebook-browser-1',
    unquotedProgramNameWithAQuote:
      'C:\\a"b c\\chrome.exe --user-data-dir=C:\\T\\codebook-browser-1',
    leadingSpacesBeforeTheProgram:
      '  chrome.exe --user-data-dir=C:\\T\\codebook-browser-1',
    lineBreakInTheProgramName:
      'chrome\n.exe --user-data-dir=C:\\T\\codebook-browser-1',
    unterminatedQuotedProgramName:
      '"C:\\a b\\chrome.exe --user-data-dir=C:\\T\\codebook-browser-1',
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
    separatorsOnly: [''],
    programNameClosesAtItsQuote: [
      'C:\\P F\\chrome.exe',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    doubledQuoteThenSpaceInQuotes: [
      'chrome.exe',
      'a"b',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    tripleQuoteOutsideQuotes: [
      'chrome.exe',
      '"',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    unquotedProgramNameWithAQuote: [
      'C:\\a"b',
      'c\\chrome.exe',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    leadingSpacesBeforeTheProgram: [
      '',
      'chrome.exe',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    lineBreakInTheProgramName: [
      'chrome',
      '\n.exe',
      '--user-data-dir=C:\\T\\codebook-browser-1',
    ],
    unterminatedQuotedProgramName: [
      'C:\\a b\\chrome.exe --user-data-dir=C:\\T\\codebook-browser-1',
    ],
  })
})

// Value: protects=a live profile on Windows whose Chrome was given its folder by a switch written in another case or with another of Chrome's switch prefixes, which Chrome reads as the same switch (base::CommandLine lowercases switch names on Windows and reads `--`, `-` and `/`), while a switch after the terminator `--` and a switch without a value give no profile (AD14, /ship adversarial review Step 11); fails_when=the switch is matched by its exact text, so `--User-Data-Dir=` hides a live profile from the sweep, or a loose argument after `--` is taken for the switch; why_new=the switch was matched as `--user-data-dir=` alone; seam=the system the command lines are read for (`win32`) and a listing of the test's own, matched against a real profile folder
test('on Windows a profile switch written in another case or with another of Chrome’s prefixes is matched, and one after the switch terminator is not', async (context) => {
  // Arrange
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-switch-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const listing = [
    { pid: 31, command: `chrome.exe "--User-Data-Dir=${profile}"` },
    { pid: 32, command: `chrome.exe "-user-data-dir=${profile}"` },
    { pid: 33, command: `chrome.exe "/USER-DATA-DIR=${profile}"` },
    { pid: 34, command: `chrome.exe -- "--user-data-dir=${profile}"` },
    { pid: 35, command: `chrome.exe --user-data-dir "${profile}"` },
  ]
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(
    observed.map((listed) => listed.pid),
    [31, 32, 33],
  )
})

// Value: protects=a live profile on Windows whose Chrome names the folder in another way than the folder's resolved path: in another case, with `/` separators, or with `..` in it, which Windows reads as the same folder, so the owned Chrome is still found and a sweep never takes its folder for unused, while another folder whose path only starts with it is not matched (CX9, /ship Codex adversarial review); fails_when=the profile is compared by exact text on Windows, so a variant of the same path is left out and the live profile looks unused; why_new=every Windows profile test wrote the path as `realpath` gives it; seam=the system the command lines are read for (`win32`) and a listing of the test's own, matched against a real profile folder
test('on Windows a profile named in another case, with forward slashes or with a parent step is still matched, and another folder is not', async (context) => {
  // Arrange: a real profile folder, and the command lines of Chrome processes that name it in the ways Windows reads as the same folder.
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-case-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const chrome = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
  const listing = [
    {
      pid: 21,
      command: `${chrome} "--user-data-dir=${profile.toUpperCase()}"`,
    },
    {
      pid: 22,
      command: `${chrome} "--user-data-dir=${profile.replaceAll('/', '\\')}"`,
    },
    {
      pid: 23,
      command: `${chrome} "--user-data-dir=${join(parent, 'elsewhere')}${'/../codebook-browser-x'}"`,
    },
    {
      pid: 24,
      command: `${chrome} "--user-data-dir=${profile.toUpperCase()}-OTHER"`,
    },
  ]
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(
    observed.map((listed) => listed.pid),
    [21, 22, 23],
  )
})

// Value: protects=a live profile whose Chrome was given several profile switches: Chrome takes the last one (base::CommandLine replaces a switch's value by a later one), so the last switch decides, on macOS and Linux as on Windows: an earlier switch of a folder that only shares a prefix does not hide the live profile, and an earlier switch of the folder does not claim it when a later one names another (AD30, /ship adversarial review Step 11); fails_when=only the first switch in the text is checked, so `--user-data-dir=<folder>b --user-data-dir=<folder>` leaves the live profile out and the sweep takes it for unused, or any switch is taken although Chrome uses another; why_new=every test named one switch; seam=the system the command lines are read for and a listing of the test's own, matched against a real profile folder
test('of several profile switches the last one decides, on Linux and on Windows', async (context) => {
  // Arrange
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-last-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const listing = [
    {
      pid: 41,
      command: `chrome --user-data-dir=${profile}b --user-data-dir=${profile} --headless`,
    },
    {
      pid: 42,
      command: `chrome --user-data-dir=${profile} --user-data-dir=${parent}/other`,
    },
    { pid: 43, command: `chrome -user-data-dir=${profile}` },
  ]
  // Act
  const observed = {
    linux: await profileProcesses(profile, listing, { platform: 'linux' }),
    windows: await profileProcesses(profile, listing, { platform: 'win32' }),
  }
  // Assert
  assert.deepEqual(
    {
      linux: observed.linux.map((listed) => listed.pid),
      windows: observed.windows.map((listed) => listed.pid),
    },
    { linux: [41, 43], windows: [41, 43] },
  )
})

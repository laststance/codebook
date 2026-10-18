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
  // A loose argument ends Node's own options without a switch terminator (`--`): on Windows, Chrome and {@link profileProcesses} read no switch after one, so the profile switch would not count.
  const owned = spawn(process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
    'chrome',
    `--user-data-dir=${profile}`,
  ])
  const unrelated = spawn(process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
    'chrome',
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

// Value: protects=the arguments a Windows command line holds as Chrome receives them, by which a profile is matched on Windows: Chrome reads its command line with CommandLineToArgvW, whose program name ends at its closing quote or at the first space or tab (a line break is a character of it), and whose quoted parts, runs of quotes and backslashes before quotes follow its own rules (the inputs of the /ship adversarial review's probe, AD14); a backslash elsewhere stays a character of a path; fails_when=the splitter follows the C runtime's rules where they differ, so `"C:\P F\chrome.exe"--user-data-dir=X` hides the switch inside the program name, a doubled or tripled quote joins two arguments, a path loses a backslash, or an unquoted program name ends at a line break, which Wine's loop does not end it at (CX2; AD14, /ship adversarial review Step 11; R15, the third OCR review); why_new=the splitter followed the C runtime; seam=none (expected values checked against the reviewer's port of Wine's CommandLineToArgvW)
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
      'chrome\n.exe',
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

// Value: protects=a live profile whose Chrome was given several profile switches: Chrome takes the last one (base::CommandLine replaces a switch's value by a later one), so the last switch decides, on macOS and Linux as on Windows: an earlier switch of a folder that only shares a prefix does not hide the live profile, and an earlier switch of the folder does not claim it when a later one names another (AD30, /ship adversarial review Step 11); fails_when=only the first switch in the text is checked, so `--user-data-dir=<folder>b --user-data-dir=<folder>` leaves the live profile out and the sweep takes it for unused, or any switch is taken although Chrome uses another, or the last switch is sought per prefix, so `-user-data-dir=<folder>b --user-data-dir=<folder>` hides the live profile, or a Windows path that ends with a separator is not the folder (TT17, the third testing review); why_new=every test named one switch; seam=the system the command lines are read for and a listing of the test's own, matched against a real profile folder
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
    // The last switch decides across Chrome's two prefixes, and a Windows path may end with a separator.
    {
      pid: 44,
      command: `chrome -user-data-dir=${profile}b --user-data-dir=${profile}`,
    },
    { pid: 45, command: `chrome.exe --user-data-dir=${profile}\\` },
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
    { linux: [41, 43, 44], windows: [41, 43, 44, 45] },
  )
})

// Value: protects=a live profile whose Chrome holds a loose argument `--user-data-dir=…` after the switch terminator (`--`): Chrome reads no switch after it, so the switch before it is Chrome's, and the sweep must not take the folder for unused and remove it (R1, /ship third review, Codex B2); fails_when=the macOS and Linux reader takes the last profile switch of the whole line, so a switch after the terminator hides the live profile, or it ends the switches at two dashes inside an argument, so a later real switch is missed; why_new=the reader of the text `ps` prints looked for no terminator; seam=the system the command lines are read for and a listing of the test's own, matched against a real profile folder; no_claim=a switch after a terminator on macOS and Linux, which still counts there, because the text cannot tell a terminator from two dashes inside an argument (pid 52 keeps its folder)
test('the profile switch before a switch terminator decides on Linux and on Windows, and on Linux two dashes inside an argument hide no later switch', async (context) => {
  // Arrange: Chrome uses the test's profile in 51; in 52 it uses another folder and names the test's only as a loose argument; in 53 two dashes stand inside an argument's text before the real switch on Linux.
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-terminator-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const listing = [
    {
      pid: 51,
      command: `chrome --user-data-dir=${profile} -- --user-data-dir=${parent}/other`,
    },
    {
      pid: 52,
      command: `chrome --user-data-dir=${parent}/other -- --user-data-dir=${profile}`,
    },
    {
      pid: 53,
      command: `chrome --window-name=a -- b --user-data-dir=${profile}`,
    },
  ]
  // Act
  const observed = {
    linux: await profileProcesses(profile, listing, { platform: 'linux' }),
    windows: await profileProcesses(profile, listing, { platform: 'win32' }),
  }
  // Assert: Windows splits the line exactly, so 53 holds a real terminator there.
  assert.deepEqual(
    {
      linux: observed.linux.map((listed) => listed.pid),
      windows: observed.windows.map((listed) => listed.pid),
    },
    { linux: [51, 52, 53], windows: [51] },
  )
})

// Value: protects=a live profile on Windows whose Chrome was given its profile switch, or the switch terminator, with white space at an end of the argument (`" --user-data-dir=C:\\…\\codebook-browser-x "`): Chrome trims each argument with its own set of white space before it reads a switch, so it uses that folder, and the sweep must not take it for unused (R2, /ship third review, Codex B2); fails_when=the argument is read as it stands, so a trimmed switch is missed and the sweep removes the live profile, or a trimmed terminator is not seen and a loose switch after it hides the real one, or the arguments are trimmed by another set than Chrome's (`String.prototype.trim` keeps NEXT LINE and removes the byte order mark); why_new=every Windows row named arguments without white space at their ends; seam=the system the command lines are read for (`win32`) and a listing of the test's own, matched against a real profile folder
test('on Windows a profile switch or a terminator with white space at its ends is read as Chrome trims it, by Chrome’s own set of white space', async (context) => {
  // Arrange: 61 and 62 give the profile with a space and with NEXT LINE at an end; 63 starts with a byte order mark, which Chrome keeps; in 64 a terminator written with spaces ends the switches before a loose one that names the profile.
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-trim-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const listing = [
    { pid: 61, command: `chrome.exe " --user-data-dir=${profile} "` },
    { pid: 62, command: `chrome.exe "--user-data-dir=${profile}\u0085"` },
    { pid: 63, command: `chrome.exe "\ufeff--user-data-dir=${profile}"` },
    {
      pid: 64,
      command: `chrome.exe --user-data-dir=${parent}/other " -- " --user-data-dir=${profile}`,
    },
  ]
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(
    observed.map((listed) => listed.pid),
    [61, 62],
  )
})

// Value: protects=a live profile on Windows whose Chrome holds `--single-argument` after its profile switch: Chrome there takes the rest of its command line as one loose argument (IsSwitchWithKey(..., kSingleArgument) in base/command_line.cc), so a `--user-data-dir` after it names nothing, and the sweep must not take the profile before it for unused; the name is compared as written, with any of Chrome's prefixes, and on macOS and Linux the switch means nothing (BB1, the fixes of the third review); fails_when=the Windows reader reads switches past `--single-argument`, so a later switch hides the live profile, or it stops at `--Single-Argument`, which Chrome reads as an ordinary switch, or the macOS and Linux reader stops there too; why_new=the reader stopped at the terminator alone; seam=the system the command lines are read for and a listing of the test's own, matched against a real profile folder
test('on Windows no switch after --single-argument counts, as Chrome reads it, while --Single-Argument and the switch on Linux end nothing', async (context) => {
  // Arrange: in 71 and 72 the profile's switch stands before the switch, written with two prefixes, and another folder's after it; in 73 the name is written in another case, so the switch after it counts; 74 is the line of 71 on Linux, where the last switch counts.
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-single-argument-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const other = join(parent, 'other')
  const listing = [
    {
      pid: 71,
      command: `chrome.exe --user-data-dir=${profile} --single-argument --user-data-dir=${other}`,
    },
    {
      pid: 72,
      command: `chrome.exe --user-data-dir=${profile} /single-argument=x --user-data-dir=${other}`,
    },
    {
      pid: 73,
      command: `chrome.exe --user-data-dir=${other} --Single-Argument --user-data-dir=${profile}`,
    },
  ]
  // Act
  const observed = {
    windows: await profileProcesses(profile, listing, { platform: 'win32' }),
    linux: await profileProcesses(profile, listing, { platform: 'linux' }),
  }
  // Assert: on Linux 71 and 72 name the other folder last; 73 names the profile last.
  assert.deepEqual(
    {
      windows: observed.windows.map((listed) => listed.pid),
      linux: observed.linux.map((listed) => listed.pid),
    },
    { windows: [71, 72, 73], linux: [73] },
  )
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'

import { listProcesses } from '../runtimeSupport/utils/listProcesses'
import { profileProcesses } from '../runtimeSupport/utils/profileProcesses'
import { windowsCommandLineArguments } from '../runtimeSupport/utils/windowsCommandLineArguments'

/** How long the scan of the command with 40,000 possible terminators may take. On the development host (16 CPUs, Node 24.21.0; median of 20 runs in a worker, as the test runs it) the scan takes 2.5 ms, and 3.8 ms under c8; the scan that read every reading's growing prefix again, which row 1053 replaced, took 1,600 ms with or without c8. The bound is over 100 times the one and a quarter of the other, so a slower host or coverage does not reach it while that regression does on this host already. */
const PROFILE_SCAN_BOUND_MS = 400
/** A worker can be stopped even when a regressed parser blocks its own event loop. */
const PROFILE_SCAN_DEADLINE_MS = 10_000

// Value: protects=cleanup polls from repeated prefix scans of unrelated process commands; fails_when=each possible terminator restarts profile parsing; why_new=row 1053; seam=a worker so a synchronous regression can be stopped
test('a POSIX command with 40,000 possible terminators is matched in under 400 ms', async (context) => {
  // Arrange
  const profile = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-linear-')),
  )
  context.after(() => rm(profile, { recursive: true, force: true }))
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads')
const { profileProcesses } = require(workerData.module)
const command = 'chrome --user-data-dir=/other' + ' -- x'.repeat(40_000)
const started = performance.now()
profileProcesses(workerData.profile, [{ pid: 101, command }], { platform: 'darwin' })
  .then(found => parentPort.postMessage({ milliseconds: performance.now() - started, pids: found.map(({ pid }) => pid) }))`,
    {
      eval: true,
      workerData: {
        module: join(
          __dirname,
          '..',
          'runtimeSupport',
          'utils',
          'profileProcesses.js',
        ),
        profile,
      },
    },
  )
  const deadline = setTimeout(() => {
    void worker.terminate()
  }, PROFILE_SCAN_DEADLINE_MS)
  try {
    // Act
    const result = await new Promise<{ milliseconds: number; pids: number[] }>(
      (resolve, reject) => {
        worker.once('message', resolve)
        worker.once('error', reject)
        worker.once('exit', (code) =>
          reject(
            new Error(`Profile worker exited before its answer (${code}).`),
          ),
        )
      },
    )

    // Assert
    assert.deepEqual(result.pids, [])
    assert.ok(
      result.milliseconds < PROFILE_SCAN_BOUND_MS,
      `${result.milliseconds} ms exceeded 400 ms`,
    )
  } finally {
    clearTimeout(deadline)
    await worker.terminate()
  }
})

// Value: protects=every conservative POSIX reading when a profile path itself contains a possible terminator and a trailing space; fails_when=only the first or last terminator is considered, an overwritten switch counts, or a reading ending exactly at the folder is lost; why_new=row 1053; seam=ps command text and a real folder
test('each possible POSIX terminator uses its latest profile switch, even inside a folder name', async (context) => {
  // Arrange
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-readings-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'owned -- profile ')
  await mkdir(profile)
  const listing = [
    {
      pid: 1,
      command: `chrome --user-data-dir=/other -- -user-data-dir=${profile}\t-- --user-data-dir=/other`,
    },
    {
      pid: 2,
      command: `chrome --user-data-dir=${profile} --user-data-dir=/other -- --user-data-dir=/other`,
    },
    {
      pid: 3,
      command: `chrome --user-data-dir=${profile}-- --user-data-dir=/other`,
    },
    {
      pid: 4,
      command: `chrome --user-data-dir=/other -- -user-data-dir=${profile}x --`,
    },
    { pid: 5, command: `chrome --user-data-dir=/other -- --user-data-dir=` },
    {
      pid: 6,
      command: `chrome --user-data-dir=/other\n--\n-user-data-dir=${profile}`,
    },
  ]

  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'darwin',
  })

  // Assert
  assert.deepEqual(
    observed.map(({ pid }) => pid),
    [1, 3, 6],
  )
})

// Value: protects=Chrome's different POSIX and Windows whitespace sets, including NEXT LINE and the byte order mark; fails_when=the linear trim changes the set or removes internal whitespace; why_new=row 1052 replaces both argument trims; seam=exact Linux arguments and Windows command text
test('profile switches keep Chrome’s exact whitespace sets on Linux and Windows', async (context) => {
  // Arrange
  const profile = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-whitespace-')),
  )
  context.after(() => rm(profile, { recursive: true, force: true }))
  const characters = [
    '\t',
    '\n',
    '\v',
    '\f',
    '\r',
    ' ',
    '\u0085',
    '\u00a0',
    '\u1680',
    '\u2000',
    '\u2001',
    '\u2002',
    '\u2003',
    '\u2004',
    '\u2005',
    '\u2006',
    '\u2007',
    '\u2008',
    '\u2009',
    '\u200a',
    '\u2028',
    '\u2029',
    '\u202f',
    '\u205f',
    '\u3000',
    '\u0001',
    '\u001f',
    '\u007f',
    '\u180e',
    '\u200b',
    '\ufeff',
  ]
  const argumentsByPid = characters.map((character) => [
    'chrome',
    `${character}--user-data-dir=${profile}${character}`,
  ])
  const linuxListing = argumentsByPid.map((args, index) => ({
    pid: index + 1,
    command: args.join(' '),
  }))
  const windowsListing = argumentsByPid.map((args, index) => ({
    pid: index + 1,
    command: `chrome "${args[1]}"`,
  }))

  // Act
  const linux = await profileProcesses(profile, linuxListing, {
    platform: 'linux',
    readArguments: async (pid) => argumentsByPid[pid - 1],
  })
  const windows = await profileProcesses(profile, windowsListing, {
    platform: 'win32',
  })

  // Assert
  assert.deepEqual(
    linux.map(({ pid }) => pid),
    [1, 2, 3, 4, 5, 6],
  )
  assert.deepEqual(
    windows.map(({ pid }) => pid),
    [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25,
    ],
  )
})

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

// Value: protects=on Windows the last profile switch decides even without `=`, which clears an earlier folder; fails_when=a valueless switch is skipped and the old folder is kept as used (BB5); why_new=the valueless switch was tested only without an earlier value; seam=Windows command lines and a real profile folder.
test('on Windows a later profile switch without a value clears an earlier folder, unless it follows the switch terminator', async (context) => {
  // Arrange
  const profile = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-empty-')),
  )
  context.after(() => rm(profile, { recursive: true, force: true }))
  const listing = [
    {
      pid: 41,
      command: `chrome.exe "--user-data-dir=${profile}" --user-data-dir`,
    },
    {
      pid: 42,
      command: `chrome.exe "--user-data-dir=${profile}" -User-Data-Dir`,
    },
    {
      pid: 43,
      command: `chrome.exe "--user-data-dir=${profile}" /USER-DATA-DIR`,
    },
    {
      pid: 44,
      command: `chrome.exe --user-data-dir "--user-data-dir=${profile}"`,
    },
    {
      pid: 45,
      command: `chrome.exe "--user-data-dir=${profile}" -- --user-data-dir`,
    },
  ]
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(
    observed.map((listed) => listed.pid),
    [44, 45],
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

// Value: protects=a live profile on Linux whose Chrome holds a real `--` argument: the process's exact arguments, read from /proc, tell that argument from two dashes inside another, so the switch before it is Chrome's and a loose `--user-data-dir=` after it names nothing (BB4, the fixes of the third review; R1 kept the text reading, which keeps such a folder); fails_when=Linux reads only the text `ps` printed, where every reading counts, so a folder named only after the terminator is taken for one in use, or a folder named before it is missed; why_new=the profile match read the text alone on every system but Windows; seam=none (a real process, the real listing and /proc of this machine)
test(
  'on Linux the exact arguments of a running process decide: the folder named before its real -- is in use, and the one named after it is not',
  {
    skip:
      process.platform !== 'linux' &&
      'the exact arguments are read from /proc, which Linux alone has',
  },
  async (context) => {
    // Arrange: a process whose arguments name one folder before a `--` argument and another after it.
    const parent = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-profile-exact-')),
    )
    context.after(() => rm(parent, { recursive: true, force: true }))
    const before = join(parent, 'codebook-browser-before')
    const after = join(parent, 'codebook-browser-after')
    await mkdir(before)
    await mkdir(after)
    // A loose argument ends Node's own options, so the arguments after it stand as in Chrome's command line.
    const browser = spawn(
      process.execPath,
      [
        '-e',
        'process.stdout.write("ready"); setInterval(() => {}, 1000)',
        'chrome',
        `--user-data-dir=${before}`,
        '--',
        `--user-data-dir=${after}`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    context.after(() => browser.kill('SIGKILL'))
    await once(browser.stdout, 'data')
    // Act
    const processes = await listProcesses()
    const named = {
      before: (await profileProcesses(before, processes)).some(
        (listed) => listed.pid === browser.pid,
      ),
      after: (await profileProcesses(after, processes)).some(
        (listed) => listed.pid === browser.pid,
      ),
    }
    // Assert
    assert.deepEqual(named, { before: true, after: false })
  },
)

// Value: protects=the profile match on Linux where a process's exact arguments cannot be trusted or read: a process that wrote its title over its arguments (Chrome's helpers may), a process id another process took since the listing, and a process whose /proc file cannot be read are matched by the text `ps` printed, so no live profile is missed; where they can be, Chrome's own rules decide (a trailing `/` names the same folder, a later switch without a value names none), and only the processes whose text names a profile switch are read (BB4, the fixes of the third review); fails_when=a rewritten title, another process's arguments or a failed read decides the match, so a live profile is missed, the exact rules differ from Chrome's, or every listed process costs a read of /proc; why_new=the exact reading is new; seam=the system the command lines are read for (`linux`), a listing of the test's own, and the reader of exact arguments, which answers by process id and notes each read
test('on Linux a process whose exact arguments cannot be trusted or read is matched by its text, the others by Chrome’s rules, and only processes that name a profile switch are read', async (context) => {
  // Arrange
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-profile-exact-rules-')),
  )
  context.after(() => rm(parent, { recursive: true, force: true }))
  const profile = join(parent, 'codebook-browser-x')
  await mkdir(profile)
  const listing = [
    // 81: a helper that wrote its title over its arguments; 82: another process has the id now; 83: its file cannot be read.
    { pid: 81, command: `chrome --type=renderer --user-data-dir=${profile}` },
    { pid: 82, command: `chrome --user-data-dir=${profile}` },
    { pid: 83, command: `chrome --user-data-dir=${profile}` },
    // 84: the folder with a trailing `/`; 85: a later switch without a value; 86: no profile switch, which is never read.
    { pid: 84, command: `chrome --user-data-dir=${profile}/` },
    {
      pid: 85,
      command: `chrome --user-data-dir=${profile} --user-data-dir`,
    },
    { pid: 86, command: 'node server.js' },
  ]
  const argumentsByProcess = new Map<number, string[]>([
    [81, [`chrome --type=renderer --user-data-dir=${profile}`]],
    [82, ['/usr/bin/bash', '-c', 'sleep 60']],
    [84, ['chrome', `--user-data-dir=${profile}/`]],
    [85, ['chrome', `--user-data-dir=${profile}`, '--user-data-dir']],
    [86, ['node', 'server.js']],
  ])
  const read: number[] = []
  // Act
  const observed = await profileProcesses(profile, listing, {
    platform: 'linux',
    readArguments: async (pid) => {
      read.push(pid)
      return argumentsByProcess.get(pid)
    },
  })
  // Assert
  assert.deepEqual(
    { matched: observed.map((listed) => listed.pid), read: read.toSorted() },
    { matched: [81, 82, 83, 84], read: [81, 82, 83, 84, 85] },
  )
})

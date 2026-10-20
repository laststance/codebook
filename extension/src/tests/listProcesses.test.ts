import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'

import {
  listProcesses,
  type ProcessListingInputs,
} from '../runtimeSupport/utils/listProcesses'

import { standInForPs } from './utils/standInForPs'

/** One call of the listing's runner as a test records it. */
type ListingCall = {
  file: string
  listingArguments: string[]
  options: Parameters<NonNullable<ProcessListingInputs['run']>>[2]
}

/**
 * Builds a runner that records every call and answers the same text or rejects with the same error, in place of `ps` and PowerShell.
 * @param answer - What the listing prints, or the error it fails with.
 * @returns `run` for {@link ProcessListingInputs}, and `calls` with every call so far.
 * @example
 * const listing = answeringListing({ stdout: '    1 /sbin/launchd\n' })
 * await listProcesses({ platform: 'darwin', run: listing.run }) // listing.calls[0].file => 'ps'
 */
function answeringListing(answer: { stdout: string } | Error): {
  run: NonNullable<ProcessListingInputs['run']>
  calls: ListingCall[]
} {
  const calls: ListingCall[] = []
  return {
    calls,
    run: async (file, listingArguments, options) => {
      calls.push({ file, listingArguments, options })
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

// Value: protects=the one listing a profile sweep and a profile probe use is bounded on macOS and Linux and reads every process with its whole command line; fails_when=the listing loses its time bound, its output limit or its kill signal (a `ps` that hangs then holds the sweep, which the browser's close awaits, and a long listing ends as an error), or a line is read without its arguments (Cycle 0046 row 87); why_new=the command and its bounds had no test; seam=the injected platform and runner. macOS itself is not observed on this machine: this pins the command line and the parsing.
test('macOS and Linux list the processes with one bounded ps and read each line as a process id and its whole command line', async () => {
  // Arrange: an answer as `ps -axww -o pid=,uid=,command=` prints it for user 501, with padded ids, a command line with spaces and an empty last line.
  const answer = {
    stdout:
      '    1   501 /sbin/launchd\n 4242   501 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --headless=new\n\n',
  }
  const onMac = answeringListing(answer),
    onLinux = answeringListing(answer)
  // Act
  const listedOnMac = await listProcesses({
    platform: 'darwin',
    run: onMac.run,
    userId: 501,
    isProgramFile: async (path) => path === '/bin/ps',
  })
  const listedOnLinux = await listProcesses({
    platform: 'linux',
    run: onLinux.run,
    userId: 501,
    isProgramFile: async (path) => path === '/bin/ps',
  })
  // Assert
  const call = {
    file: '/bin/ps',
    listingArguments: ['-axww', '-o', 'pid=,uid=,command='],
    options: {
      timeout: 10_000,
      maxBuffer: 67_108_864,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
  }
  const processes = [
    { pid: 1, command: '/sbin/launchd' },
    {
      pid: 4242,
      command:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --headless=new',
    },
  ]
  assert.deepEqual(onMac.calls, [call])
  assert.deepEqual(onLinux.calls, [call])
  assert.deepEqual(listedOnMac, processes)
  assert.deepEqual(listedOnLinux, processes)
})

// Value: protects=a managed run on a machine shared with other users: its attach and its close match its profile only against this user's processes; fails_when=the listing keeps every user's processes, so another user's process that names the run's codebook-browser profile (with a debugging port, or one that never exits) fails the attach ("Owned Chrome is not using the declared debugging pipe") or holds the close until its bound; why_new=Cycle 0047 row 37 (P3RT15); seam=the injected platform, runner and user id; no_claim=a real process of another user, which this machine cannot start
test('macOS and Linux list only the processes of this user, so another user’s process that names a run’s profile is not listed', async () => {
  // Arrange: this user is 501; user 502 runs a process that names the same profile with a debugging port.
  const answer = {
    stdout:
      ' 4242   501 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --remote-debugging-pipe\n 5150   502 /usr/bin/sleep 600 --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --remote-debugging-port=9222\n',
  }
  const onMac = answeringListing(answer),
    onLinux = answeringListing(answer)
  const inputsOf = (
    platform: NodeJS.Platform,
    run: NonNullable<ProcessListingInputs['run']>,
  ): ProcessListingInputs => ({
    platform,
    run,
    userId: 501,
    isProgramFile: async (path) => path === '/bin/ps',
  })

  // Act
  const listed = {
    onMac: await listProcesses(inputsOf('darwin', onMac.run)),
    onLinux: await listProcesses(inputsOf('linux', onLinux.run)),
  }

  // Assert
  const ofThisUser = [
    {
      pid: 4242,
      command:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --remote-debugging-pipe',
    },
  ]
  assert.deepEqual(listed, { onMac: ofThisUser, onLinux: ofThisUser })
})

// Row 37's test of the query for the editor's session alone gave way to the one below, which keeps its end (another user's process is never listed) by the listing's answer.
// Value: protects=a managed run and the sweep of abandoned profile folders on a Windows machine with several logon sessions: a browser of this user in another session of this user (a remote session whose editor ended) is listed, a process of another user is never listed (row 37), and a process of another session whose owner cannot be read is listed only when the caller asks for it (the sweep, which then holds the folder it names), never for a run's attach and close; fails_when=the listing keeps only the editor's own session, so the sweep removes the files of a profile this user's browser still uses in its other session (Cycle 0047 row 196), or another user's process is listed and fails a run's attach or holds its close (row 37), or a process whose owner cannot be read is taken for the run's browser; why_new=Cycle 0047 row 196 (S2CXA-C2-2): row 37 kept only the editor's session; seam=the injected platform, environment and runner, which answers as the query prints for four browsers in three sessions; no_claim=a second logon session, which this machine does not have (the query ran in full and in Constrained Language mode on this machine's Windows PowerShell 5.1, its owner call also on the processes of session 0)
test('the Windows listing lists this user’s browser in another logon session and never another user’s, and one whose owner cannot be read only when the caller asks for it', async () => {
  // Arrange: the editor runs in session 1 as S-1-5-21-1000-1001. Chrome 4242 runs in the editor's session, 5150 in session 2 as the same user, 6006 in session 3 as another user, and 7007 in session 3 with an owner that could not be read.
  const listing = answeringListing({
    stdout:
      'editor 1 S-1-5-21-1000-1001\r\n4242 1 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-a\r\n5150 2 S-1-5-21-1000-1001 %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-b\r\n6006 3 S-1-5-21-1000-1002 %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-c\r\n7007 3 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-d\r\n',
  })

  // Act
  const listed = {
    forARun: await listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
    }),
    forTheSweep: await listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
      keepsUnconfirmedOwners: true,
    }),
  }

  // Assert
  const inTheEditorsSession = {
    pid: 4242,
    command:
      '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-a',
  }
  const inAnotherSessionOfThisUser = {
    pid: 5150,
    command:
      '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-b',
  }
  assert.deepEqual(listed, {
    forARun: [inTheEditorsSession, inAnotherSessionOfThisUser],
    forTheSweep: [
      inTheEditorsSession,
      inAnotherSessionOfThisUser,
      {
        pid: 7007,
        command:
          '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-d',
      },
    ],
  })
})

// Value: protects=the profile sweep on a Windows machine where the editor cannot read its own owner: a browser of another logon session may be this user's, so the sweep keeps it; fails_when=the owner check reads only the process's unread owner, so a process of another session with a readable owner counts as another user's and the sweep removes the profile folder it uses; why_new=the logon-session test reads the editor's owner; no test lists processes while the editor's own owner is unread (Cycle 0047 row 196); seam=none (the runner stands in for PowerShell); no_claim=PowerShell's GetOwnerSid on a real machine (the printed answer stands in for it)
test('the Windows listing of an editor whose own owner cannot be read lists a process of another logon session only for the sweep, whatever owner that process names', async () => {
  // Arrange: the editor runs in session 1 and its own owner could not be read. Chrome 4242 runs in the editor's session, 5150 in session 2 with a readable owner, and 6006 in session 3 with an owner that could not be read either.
  const listing = answeringListing({
    stdout:
      'editor 1 ?\r\n4242 1 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-a\r\n5150 2 S-1-5-21-1000-1001 %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-b\r\n6006 3 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-c\r\n',
  })

  // Act
  const listed = {
    forARun: await listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
    }),
    forTheSweep: await listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
      keepsUnconfirmedOwners: true,
    }),
  }

  // Assert: only the editor's own session is this user's for sure; the other two sessions hold the sweep and never reach a run.
  assert.deepEqual(listed, {
    forARun: [
      {
        pid: 4242,
        command:
          '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-a',
      },
    ],
    forTheSweep: [
      {
        pid: 4242,
        command:
          '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-a',
      },
      {
        pid: 5150,
        command:
          '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-b',
      },
      {
        pid: 6006,
        command:
          '"c:\\chrome.exe" --user-data-dir=C:\\Users\\learner\\AppData\\Local\\codebook-browser-c',
      },
    ],
  })
})

// Value: protects=the sweep of abandoned profile folders on Windows, which matches every folder against this listing, and a run's attach and close: a listing without its editor line cannot judge any process as this user's, so it is refused, never read as a machine where no process runs; fails_when=a listing that printed no line of the editor's own logon session answers [] (as before row 196), so the sweep takes every folder for unused and removes the profile a live browser of this user still uses; why_new=Cycle 0047 row 257 (P3TEST-6): since row 196 every Windows listing test feeds an editor line; seam=the injected platform, environment and runner, which answers with process lines as the query prints them and no editor line; no_claim=what makes a real PowerShell print no editor line
test('a Windows listing that printed no line of the editor’s own logon session is refused, for a run and for the sweep, instead of answering that no process runs', async () => {
  // Arrange: a browser of the editor's session as the query prints it, without the `editor <session> <user>` line that comes first.
  const listing = answeringListing({
    stdout:
      '4242 1 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5Clearner%5CAppData%5CLocal%5Ccodebook-browser-a\r\n',
  })

  // Act
  const outcomes = await Promise.allSettled([
    listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
    }),
    listProcesses({
      platform: 'win32',
      run: listing.run,
      environment: { SystemRoot: 'C:\\Windows' },
      keepsUnconfirmedOwners: true,
    }),
  ])

  // Assert
  assert.deepEqual(
    outcomes.map((outcome) =>
      outcome.status === 'rejected'
        ? String(outcome.reason)
        : `listed ${outcome.value.length}`,
    ),
    [
      'Error: The process listing (PowerShell) printed no line of its own logon session, so no process could be judged as this user’s.',
      'Error: The process listing (PowerShell) printed no line of its own logon session, so no process could be judged as this user’s.',
    ],
  )
})

// Value: protects=the time of a Windows listing on a machine shared by several logon sessions (an RDS or Citrix host, fast user switching): the query reads the owner (GetOwnerSid, one call each) only of a process of another session whose command line names a Codebook profile folder (`codebook-browser-`, the start of every managed profile folder's name), so other users' Electron and WebView2 children, which pass `--user-data-dir` too, cost no call and the listing stays within its 10 s bound at every 500 ms look of a run's attach and close; fails_when=the other sessions are matched by the profile switch `user-data-dir`, which most Chromium-based apps pass, so a few hundred owner calls in a row pass the bound: the attach fails, the close records the exit unverified and the sweep removes nothing; why_new=Cycle 0047 row 235 (P2PERF-1 = P2CLA-9): row 196's query matched the switch; seam=the injected platform, environment and runner, which records the query; no_claim=the time of a real listing on a host with a second logon session, which this machine does not have (the query ran in full and in Constrained Language mode on this machine's Windows PowerShell 5.1)
test('the Windows listing reads the owner of a process of another logon session only when its command line names a Codebook profile folder', async () => {
  // Arrange
  const listing = answeringListing({ stdout: 'editor 1 ?\r\n' })
  await listProcesses({
    platform: 'win32',
    run: listing.run,
    environment: { SystemRoot: 'C:\\Windows' },
  })
  const query = listing.calls[0]?.listingArguments.at(-1) ?? ''
  // Act: every pattern a command line is compared with; the only comparison decides which processes of another session are printed and pay for an owner call.
  const comparedPatterns = [...query.matchAll(/-like '([^']*)'/g)].map(
    (match) => match[1],
  )
  // Assert: `-like` compares without case, as Chrome reads its switches on Windows.
  assert.deepEqual(comparedPatterns, ['*codebook-browser-*'])
})

// Value: protects=the one program the listing starts on macOS and Linux: `ps` by an absolute path, /bin/ps and else /usr/bin/ps, never a `ps` found in the search path or the current folder, and with neither the listing is refused before any program is started, so a sweep removes nothing (AD30, /ship adversarial review Step 11, with SX2's rule that no lookup uses the current folder); fails_when=the listing starts the bare `ps`, which the search path names (a folder the user or a tool put first can hold another program of that name), or takes no second place where /bin has no ps; why_new=`ps` was started by its bare name; seam=the injected platform, runner and program check
test('macOS and Linux start ps from /bin, else from /usr/bin, and refuse the listing without starting a program where neither holds it', async () => {
  // Arrange
  const outcomeWith = async (
    programs: string[],
  ): Promise<{ started: string[]; asked: string[]; refusal?: string }> => {
    const listing = answeringListing({ stdout: '    1 /sbin/init\n' })
    const asked: string[] = []
    const refusal = await listProcesses({
      platform: 'linux',
      run: listing.run,
      isProgramFile: async (path) => {
        asked.push(path)
        return programs.includes(path)
      },
    }).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    return {
      started: listing.calls.map((call) => call.file),
      asked,
      ...(refusal !== undefined && { refusal }),
    }
  }
  // Act
  const outcomes = {
    inBothFolders: await outcomeWith(['/bin/ps', '/usr/bin/ps']),
    inUsrBinOnly: await outcomeWith(['/usr/bin/ps']),
    nowhere: await outcomeWith(['ps', './ps']),
  }
  // Assert
  assert.deepEqual(outcomes, {
    inBothFolders: { started: ['/bin/ps'], asked: ['/bin/ps'] },
    inUsrBinOnly: {
      started: ['/usr/bin/ps'],
      asked: ['/bin/ps', '/usr/bin/ps'],
    },
    nowhere: {
      started: [],
      asked: ['/bin/ps', '/usr/bin/ps'],
      refusal:
        'Error: The process listing was not started: no ps lies at /bin/ps or /usr/bin/ps, and Codebook starts it only from there.',
    },
  })
})

// Value: protects=a profile sweep and a profile probe on Windows, which has no `ps`, and the program it starts there; fails_when=the listing runs `ps` there (ENOENT), the PowerShell command loses -NoProfile, -NonInteractive, its error action or its bounds, opens a console window, a command line is read wrongly (a path outside ASCII, a process without a readable command line) (Cycle 0046 row 96), or PowerShell is started by its bare name, so a powershell.exe in the editor's current directory or earlier in the search path is started in its place (F4, Cycle 0046 /ship review; row 107 for the start query); why_new=the listing had no form for Windows, and its program was named by its bare name alone; seam=the injected platform, environment and runner. The real query runs in the Windows job.
test('Windows lists the processes with one bounded PowerShell query, started from the system root, and reads each line as a process id and its command line', async () => {
  // Arrange: an answer as the query prints it, with Windows line ends: the editor's session and user first, then on each line a process id, its session, its owner (`?`: not read in the editor's session) and the percent-encoding of the command line's UTF-8 bytes. Processes 0 and 4 show no command line to this user; the second command line holds a folder with a name outside ASCII ("C:\Users\学習者", "learner" in Japanese); the last holds a line break.
  const listing = answeringListing({
    stdout:
      'editor 1 S-1-5-21-1000-1001\r\n0 0 ? \r\n4 0 ? \r\n4242 1 ? %22c%3A%5Cnode.exe%22%20-e%20%22setInterval%28%28%29%20%3D%3E%20%7B%7D%2C%201000%29%22\r\n5150 1 ? %22c%3A%5Cchrome.exe%22%20--user-data-dir%3DC%3A%5CUsers%5C%E5%AD%A6%E7%BF%92%E8%80%85%5CAppData%5CLocal%5CTemp%5Ccodebook-browser-a1b2c3\r\n6006 1 ? %22c%3A%5Ctool.exe%22%20first-line%0Asecond-line\r\n',
  })
  // Act
  const listed = await listProcesses({
    platform: 'win32',
    run: listing.run,
    environment: { SystemRoot: 'C:\\Windows' },
  })
  // Assert
  assert.deepEqual(listing.calls, [
    {
      file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      listingArguments: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$editor = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = {0}' -f $PID) -Property SessionId -ErrorAction Stop; try { $user = (Invoke-CimMethod -InputObject $editor -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch { $user = '' }; if (-not $user) { $user = '?' }; 'editor {0} {1}' -f $editor.SessionId, $user; Get-CimInstance -ClassName Win32_Process -Property ProcessId,SessionId,CommandLine -ErrorAction Stop | ForEach-Object { $process = $_; if ($process.SessionId -eq $editor.SessionId -or $process.CommandLine -like '*codebook-browser-*') { $owner = '?'; if ($process.SessionId -ne $editor.SessionId) { try { $sid = (Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch { $sid = '' }; if ($sid) { $owner = $sid } }; try { $commandLine = [uri]::EscapeDataString([string]$process.CommandLine) } catch { $commandLine = '' }; '{0} {1} {2} {3}' -f $process.ProcessId, $process.SessionId, $owner, $commandLine } }",
      ],
      options: {
        timeout: 10_000,
        maxBuffer: 67_108_864,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
    },
  ])
  assert.deepEqual(listed, [
    {
      pid: 4242,
      command: '"c:\\node.exe" -e "setInterval(() => {}, 1000)"',
    },
    {
      pid: 5150,
      command:
        '"c:\\chrome.exe" --user-data-dir=C:\\Users\\学習者\\AppData\\Local\\Temp\\codebook-browser-a1b2c3',
    },
    { pid: 6006, command: '"c:\\tool.exe" first-line\nsecond-line' },
  ])
})

// Value: protects=the Windows listing's reading of what PowerShell printed: a line whose text is no percent-encoding, or one whose escapes are no UTF-8, is left out alone, while the rest of the listing stays, and a line whose escaping left RFC 2396's characters as they are (`!*'()`, as `[uri]::EscapeDataString` of an older .NET leaves `(x86)`) is read (AD22a; TT16, the third testing review); fails_when=the text is decoded without its check, so a text the query never prints becomes a command line, a malformed escape rejects the whole listing, which a sweep then reads as "remove nothing" and a close as an unverified exit, or a path with `(x86)` is left out, so a Chrome under Program Files (x86) is not seen; why_new=every fixture line was a well-formed, fully escaped text; seam=the injected platform, environment and runner
test('the Windows listing leaves out a line that is no percent-encoding of UTF-8 and keeps the rest, and reads a path whose escaping left RFC 2396’s characters as they are', async () => {
  // Arrange: a text with a `+`, which the query's escaping never prints; an escape cut inside a character; and Chrome under Program Files (x86), its `!*'()` left unescaped.
  const listing = answeringListing({
    stdout:
      "editor 1 S-1-5-21-1000-1001\r\n7 1 ? abc+def\r\n8 1 ? %E5%AD\r\n9 1 ? %22C%3A%5CProgram%20Files%20(x86)%5Cit's!*%5Cchrome.exe%22%20--headless\r\n",
  })
  // Act
  const listed = await listProcesses({
    platform: 'win32',
    run: listing.run,
    environment: { SystemRoot: 'C:\\Windows' },
  })
  // Assert
  assert.deepEqual(listed, [
    {
      pid: 9,
      command: `"C:\\Program Files (x86)\\it's!*\\chrome.exe" --headless`,
    },
  ])
})

// Value: protects=the process listing of a Windows machine whose PowerShell runs in Constrained Language mode (AppLocker or App Control for Business on a managed machine put every PowerShell there): the query names only .NET types that mode allows (about_Language_Modes: `[uri]`, `[string]`), so it runs there, and every attach and close of a managed run can see its Chrome (AD22, /ship adversarial review Step 11); fails_when=the query names a type that mode refuses, as `[Convert]` and `[Text.Encoding]` were, so "Method invocation is supported only on core types in this language mode" fails every listing; why_new=the query's types were never checked against the mode; seam=the injected platform, environment and runner. The real query runs in the Windows job, in its full language mode.
test('the Windows listing query names only .NET types that PowerShell’s Constrained Language mode allows', async () => {
  // Arrange
  const listing = answeringListing({ stdout: 'editor 1 ?\r\n' })
  await listProcesses({
    platform: 'win32',
    run: listing.run,
    environment: { SystemRoot: 'C:\\Windows' },
  })
  const query = listing.calls[0]?.listingArguments.at(-1) ?? ''
  // Act
  const namedTypes = [...query.matchAll(/\[([A-Za-z][\w.]*)\]/g)].map(
    (match) => match[1],
  )
  // Assert: both are allowed types of about_Language_Modes.
  assert.deepEqual(namedTypes, ['uri', 'string'])
})

// Value: protects=the Windows listing never starts a program found by a search: PowerShell is started from SystemRoot, else from windir, and with neither naming an absolute folder the listing is refused before any program is started, so the sweep that waits for it removes nothing (CX8, /ship Codex adversarial review; F4 and row 107 before it); fails_when=a missing, empty or relative system root makes the listing start the bare `powershell.exe`, which Windows looks up in the current directory and the search path, where another program of that name can run with the user's rights, or builds a relative path to PowerShell; why_new=the fallback to the bare name was pinned as the rule; seam=the injected platform, environment and runner
test('the Windows listing starts PowerShell from SystemRoot or windir only, and is refused without starting a program where neither names an absolute folder', async () => {
  // Arrange
  const outcomeWith = async (environment: {
    SystemRoot?: string
    windir?: string
  }): Promise<{ started: string[]; refusal?: string }> => {
    const listing = answeringListing({ stdout: 'editor 1 ?\r\n' })
    const refusal = await listProcesses({
      platform: 'win32',
      run: listing.run,
      environment,
    }).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    return {
      started: listing.calls.map((call) => call.file),
      ...(refusal !== undefined && { refusal }),
    }
  }
  const refused = {
    started: [],
    refusal:
      'Error: The process listing was not started: neither SystemRoot nor windir names the Windows folder, and Codebook starts Windows PowerShell only from it.',
  }
  // Act
  const outcomes = {
    noSystemRoot: await outcomeWith({}),
    emptySystemRoot: await outcomeWith({ SystemRoot: '' }),
    relativeSystemRoot: await outcomeWith({ SystemRoot: 'Windows' }),
    relativeWindir: await outcomeWith({ windir: 'WINNT' }),
    windirOnly: await outcomeWith({ windir: 'C:\\Windows' }),
    rootOfAnotherDrive: await outcomeWith({ SystemRoot: 'D:\\WINNT\\' }),
  }
  // Assert
  assert.deepEqual(outcomes, {
    noSystemRoot: refused,
    emptySystemRoot: refused,
    relativeSystemRoot: refused,
    relativeWindir: refused,
    windirOnly: {
      started: [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ],
    },
    rootOfAnotherDrive: {
      started: ['D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    },
  })
})

// Value: protects=the real listing of the system the suite runs on names a running process with every argument, which is what a profile is matched by; fails_when=the real command fails, prints in a form its reader does not read, or cuts the command line (on Windows: PowerShell or its query is refused, or the answer is not what the reader expects) (Cycle 0046 rows 87 and 96); why_new=only a real listing shows it, and on Windows nothing ran the listing; seam=none (a real child process of this test)
test('the listing of this system names a process the test started, with its whole command line', async (context) => {
  // Arrange: a process of this test whose last argument no other process has.
  const lastArgument = `--codebook-listing-test=${process.pid}-${Date.now()}`
  const started = spawn(
    process.execPath,
    [
      '-e',
      'process.stdout.write("ready"); setInterval(() => {}, 1000)',
      '--',
      lastArgument,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  context.after(() => started.kill('SIGKILL'))
  await once(started.stdout, 'data')
  // Act
  const listed = await listProcesses()
  // Assert
  const commandOfStarted = listed.find(
    (listedProcess) => listedProcess.pid === started.pid,
  )?.command
  assert.equal(commandOfStarted?.endsWith(lastArgument), true, commandOfStarted)
  assert.equal(
    listed.filter((listedProcess) =>
      listedProcess.command.endsWith(lastArgument),
    ).length,
    1,
  )
})

// Value: protects=a process listing that hangs does not hold what waits for it without end: the sweep of abandoned profile folders, which the browser's close awaits, and the probe of a run's own profile; fails_when=the listing runs without a time bound, or is asked to end with a signal it can ignore (Cycle 0046 row 87); why_new=the listing had no bound; seam=`ps` itself, which is a program of the test that stays silent, and the listing's time bound, shortened to 300 ms
test(
  'a process listing that never answers is ended at its time bound with a signal it cannot ignore, and the failure says so',
  { skip: process.platform === 'win32' && 'the stand-in for ps needs /bin/sh' },
  async (context) => {
    // Arrange: a `ps` that prints nothing for 20 s, far beyond the bound, and then ends by itself, so that a listing without a bound fails this test instead of holding the suite.
    const ps = await standInForPs(context, 'setTimeout(() => {}, 20_000)')
    // Act
    const failure: unknown = await listProcesses({
      timeoutMs: 300,
      psPrograms: [ps],
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    // Assert
    assert.ok(failure instanceof Error)
    assert.equal(
      failure.message,
      `The process listing (${ps}) did not answer within 300 ms and was ended.`,
    )
    assert.ok(failure.cause instanceof Error)
    assert.equal(
      'signal' in failure.cause ? failure.cause.signal : undefined,
      'SIGKILL',
    )
  },
)

// Value: protects=the process list of a machine with many long command lines is read whole; fails_when=the listing keeps the 1 MiB Node.js gives a child's output unless told otherwise, so a longer listing ends as an error, which fails the viewport of a managed run and leaves every abandoned profile folder in place (Cycle 0046 row 87); why_new=no test listed more than this machine's own processes; seam=`ps` itself, which is a program of the test that prints 4,096 processes in about 4.1 MiB
test(
  'a process listing four times as long as the default output limit of Node.js is read whole',
  { skip: process.platform === 'win32' && 'the stand-in for ps needs /bin/sh' },
  async (context) => {
    // Arrange: 4,096 lines of a process id, the user id 501 and a command line of 1,040 characters.
    const ps = await standInForPs(
      context,
      'for (let pid = 1; pid <= 4096; pid += 1) process.stdout.write(`${String(pid).padStart(7)}   501 /usr/bin/program-${pid} ${"x".repeat(1024)}\\n`)',
    )
    // Act
    const listed = await listProcesses({ psPrograms: [ps], userId: 501 })
    // Assert
    assert.equal(listed.length, 4_096)
    assert.deepEqual(listed[0], {
      pid: 1,
      command: `/usr/bin/program-1 ${'x'.repeat(1_024)}`,
    })
    assert.deepEqual(listed[4_095], {
      pid: 4_096,
      command: `/usr/bin/program-4096 ${'x'.repeat(1_024)}`,
    })
  },
)

// Value: protects=a run that waited for a listing which printed too much is told so, and any other failure of the listing reaches its caller as it is; fails_when=the output limit ends as "Command failed" or as a bare RangeError, or a missing command is reworded as a bound (Cycle 0046 row 87); why_new=the bounds are new; seam=the injected platform and runner
test('a process listing that prints more than its output limit says so, and a listing that cannot be started fails with its own error', async () => {
  // Arrange: the two errors as Node.js raises them for a child that printed too much and for a command that does not exist.
  const printedTooMuch = Object.assign(
    new RangeError('stdout maxBuffer length exceeded'),
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true },
  )
  const missingCommand = Object.assign(new Error('spawn ps ENOENT'), {
    code: 'ENOENT',
  })
  const messageOf = (answer: Error): Promise<string> =>
    listProcesses({
      platform: 'linux',
      run: answeringListing(answer).run,
      isProgramFile: async (path) => path === '/bin/ps',
    }).then(
      () => 'listed',
      (error: unknown) => String(error),
    )
  // Act
  const messages = {
    printedTooMuch: await messageOf(printedTooMuch),
    missingCommand: await messageOf(missingCommand),
  }
  // Assert
  assert.deepEqual(messages, {
    printedTooMuch:
      'Error: The process listing (/bin/ps) printed more than 67108864 bytes and was ended.',
    missingCommand: 'Error: spawn ps ENOENT',
  })
})

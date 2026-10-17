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
  // Arrange: an answer as `ps -axww -o pid=,command=` prints it, with padded ids, a command line with spaces and an empty last line.
  const answer = {
    stdout:
      '    1 /sbin/launchd\n 4242 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 --headless=new\n\n',
  }
  const onMac = answeringListing(answer),
    onLinux = answeringListing(answer)
  // Act
  const listedOnMac = await listProcesses({
    platform: 'darwin',
    run: onMac.run,
  })
  const listedOnLinux = await listProcesses({
    platform: 'linux',
    run: onLinux.run,
  })
  // Assert
  const call = {
    file: 'ps',
    listingArguments: ['-axww', '-o', 'pid=,command='],
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

// Value: protects=a profile sweep and a profile probe on Windows, which has no `ps`, and the program it starts there; fails_when=the listing runs `ps` there (ENOENT), the PowerShell command loses -NoProfile, -NonInteractive, its error action or its bounds, opens a console window, a command line is read wrongly (a path outside ASCII, a process without a readable command line) (Cycle 0046 row 96), or PowerShell is started by its bare name, so a powershell.exe in the editor's current directory or earlier in the search path is started in its place (F4, Cycle 0046 /ship review; row 107 for the start query); why_new=the listing had no form for Windows, and its program was named by its bare name alone; seam=the injected platform, environment and runner. The real query runs in the Windows job.
test('Windows lists the processes with one bounded PowerShell query, started from the system root, and reads each line as a process id and its command line', async () => {
  // Arrange: an answer as the query prints it, a process id and the Base64 of the command line's UTF-8 bytes on each line, with Windows line ends. Process 4 shows no command line to this user; the last command line holds a folder with a name outside ASCII ("C:\Users\学習者", "learner" in Japanese).
  const listing = answeringListing({
    stdout:
      '0 \r\n4 \r\n4242 ImM6XG5vZGUuZXhlIiAtZSAic2V0SW50ZXJ2YWwoKCkgPT4ge30sIDEwMDApIg==\r\n5150 ImM6XGNocm9tZS5leGUiIC0tdXNlci1kYXRhLWRpcj1DOlxVc2Vyc1zlrabnv5LogIVcQXBwRGF0YVxMb2NhbFxUZW1wXGNvZGVib29rLWJyb3dzZXItYTFiMmMz\r\n',
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
        "Get-CimInstance -ClassName Win32_Process -Property ProcessId,CommandLine -ErrorAction Stop | ForEach-Object { '{0} {1}' -f $_.ProcessId, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine)) }",
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
  ])
})

// Value: protects=the Windows listing still runs where the system root is not known, and never from a path that is looked up from the current directory; fails_when=a missing, empty or relative SystemRoot makes the listing fail or builds a relative path to PowerShell (F4, Cycle 0046 /ship review; the same lookup as the start query's, row 107); why_new=the listing named its program by its bare name alone; seam=the injected platform, environment and runner
test('the Windows listing starts PowerShell by its bare name only where the system root is missing, empty or no absolute path', async () => {
  // Arrange
  const programStartedWith = async (environment: {
    SystemRoot?: string
  }): Promise<string | undefined> => {
    const listing = answeringListing({ stdout: '' })
    await listProcesses({ platform: 'win32', run: listing.run, environment })
    return listing.calls[0]?.file
  }
  // Act
  const programs = {
    noSystemRoot: await programStartedWith({}),
    emptySystemRoot: await programStartedWith({ SystemRoot: '' }),
    relativeSystemRoot: await programStartedWith({ SystemRoot: 'Windows' }),
    rootOfAnotherDrive: await programStartedWith({ SystemRoot: 'D:\\WINNT\\' }),
  }
  // Assert
  assert.deepEqual(programs, {
    noSystemRoot: 'powershell.exe',
    emptySystemRoot: 'powershell.exe',
    relativeSystemRoot: 'powershell.exe',
    rootOfAnotherDrive:
      'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
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
    await standInForPs(context, 'setTimeout(() => {}, 20_000)')
    // Act
    const failure: unknown = await listProcesses({ timeoutMs: 300 }).then(
      () => undefined,
      (error: unknown) => error,
    )
    // Assert
    assert.ok(failure instanceof Error)
    assert.equal(
      failure.message,
      'The process listing (ps) did not answer within 300 ms and was ended.',
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
    // Arrange: 4,096 lines of a process id and a command line of 1,040 characters.
    await standInForPs(
      context,
      'for (let pid = 1; pid <= 4096; pid += 1) process.stdout.write(`${String(pid).padStart(7)} /usr/bin/program-${pid} ${"x".repeat(1024)}\\n`)',
    )
    // Act
    const listed = await listProcesses()
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
      'Error: The process listing (ps) printed more than 67108864 bytes and was ended.',
    missingCommand: 'Error: spawn ps ENOENT',
  })
})

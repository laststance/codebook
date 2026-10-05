import assert from 'node:assert/strict'
import { readlinkSync } from 'node:fs'
import { before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  readProcessStart,
  type ProcessStartInputs,
} from '../utils/readProcessStart'

import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { realProcessStart } from './utils/realProcessStart'

// The tests with real child processes need the system's answer, which on Windows is a PowerShell that starts cold: the first read is made here, with the tests' own bound, and names its query when it fails.
before(async () => {
  await realProcessStart(process.pid)
})

/** One call of the query runner as a test records it. */
type QueryCall = { file: string; queryArguments: string[]; options: object }

/**
 * Stands in for `ps` and PowerShell: records every call and answers each with the given outcome.
 * @param answer - What the query prints, or the error it ends with.
 * @returns The runner to inject and the calls it received.
 * @example
 * const query = answeringQuery({ stdout: 'Mon Oct  5 09:12:33 2026\n' })
 */
function answeringQuery(answer: { stdout: string } | Error): {
  run: NonNullable<ProcessStartInputs['run']>
  calls: QueryCall[]
} {
  const calls: QueryCall[] = []
  return {
    calls,
    run: async (file, queryArguments, options) => {
      calls.push({ file, queryArguments, options })
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

/** The text of `/proc/4194305/stat` for a process named "node" that began at the given clock tick; 4194305 is {@link ID_OF_NO_PROCESS}, an id this test process cannot have. @example linuxStat(200) // => '4194305 (node) S 1 4194305 4194305 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 200 16637952 1813' */
function linuxStat(startTicks: number): string {
  return `4194305 (node) S 1 4194305 4194305 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 ${startTicks} 16637952 1813`
}

/** Answers the link of the pid namespace as a process in the namespace 4026531836 reads it. @example inNamespace4026531836() // => 'pid:[4026531836]' */
function inNamespace4026531836(): string {
  return 'pid:[4026531836]'
}

// Value: protects=a Linux pid is told by field 22 of its stat, in the pid namespace it was read in; fails_when=the parser splits at the first ")" or counts from the line start, or the start names no namespace, so the same pid and tick in another namespace of this kernel count as this process (Cycle 0046 row 65); why_new=new utility (Cycle 0046 rows 2 and 9, ER-1); seam=the injected platform, file read and namespace link
test('reads the start of a Linux process whose command name holds spaces and parentheses, and names it with the pid namespace it was read in', async () => {
  // Arrange: the command name itself looks like the end of a name followed by fields; the reading process is in the pid namespace 4026531836.
  const readPaths: string[] = []
  const stat =
    '4194305 (a) b c d e f g h i j k l m n o p q r s 77 (z) S 1 4194305 4194305 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 16362446 16637952 1813 18446744073709551615'
  // Act
  const start = await readProcessStart(ID_OF_NO_PROCESS, {
    platform: 'linux',
    readFile: async (path) => {
      readPaths.push(path)
      return stat
    },
    readLink: (path) => {
      readPaths.push(path)
      return 'pid:[4026531836]'
    },
  })
  // Assert
  assert.equal(start, 'linux@4026531836:16362446')
  assert.deepEqual(readPaths, ['/proc/4194305/stat', '/proc/self/ns/pid'])
})

// Value: protects=a Linux window whose pid namespace cannot be read (a sandbox that hides it) still records and reads a start, in the form without a namespace, and never a broken one; fails_when=an unreadable or unexpected link gives no start at all, throws, or is written into the form as it is (Cycle 0046 row 65); why_new=the form names the namespace since row 65; seam=the injected platform, file read and namespace link
test('a Linux start whose pid namespace cannot be read, or is named in another way, has the form without a namespace', async () => {
  // Arrange
  const startWith = (readLink: () => string): Promise<string | undefined> =>
    readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'linux',
      readFile: async () => linuxStat(16362446),
      readLink,
    })
  // Act
  const starts = {
    linkCannotBeRead: await startWith(() => {
      throw Object.assign(new Error('EACCES: permission denied, readlink'), {
        code: 'EACCES',
      })
    }),
    linkNamesSomethingElse: await startWith(() => 'net:[4026531840]'),
    linkHasMoreText: await startWith(() => 'pid:[4026531836]:x'),
  }
  // Assert
  assert.deepEqual(starts, {
    linkCannotBeRead: 'linux:16362446',
    linkNamesSomethingElse: 'linux:16362446',
    linkHasMoreText: 'linux:16362446',
  })
})

// Value: protects=an unreadable stat never becomes an identity; fails_when=a short or missing stat returns a value or throws; why_new=new utility (ER-1); seam=the injected platform and file read
test('gives no start for a Linux stat with too few fields or none', async () => {
  // Arrange
  const tooFewFields = '4194305 (node) S 1 4194305 4194305 0 -1 4194304',
    noCommandName = '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22',
    startIsNoNumber =
      '4194305 (node) S 1 4194305 4194305 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 -1 16637952'
  const startOf = (stat: string): Promise<string | undefined> =>
    readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'linux',
      readFile: async () => stat,
    })
  // Act
  const starts = {
    tooFewFields: await startOf(tooFewFields),
    empty: await startOf(''),
    noCommandName: await startOf(noCommandName),
    startIsNoNumber: await startOf(startIsNoNumber),
    noSuchProcess: await readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'linux',
      readFile: async () => {
        throw Object.assign(new Error('ENOENT: no such file or directory'), {
          code: 'ENOENT',
        })
      },
    }),
  }
  // Assert
  assert.deepEqual(starts, {
    tooFewFields: undefined,
    empty: undefined,
    noCommandName: undefined,
    startIsNoNumber: undefined,
    noSuchProcess: undefined,
  })
})

// Value: protects=two windows with different TZ write and read the same text; fails_when=the query runs without TZ=UTC or LC_ALL=C, or loses its bounds; why_new=probe: the text changes with TZ (ER-1); seam=the injected platform and query runner. macOS itself is not observed on this machine: this pins the command line and the parsing.
test('asks macOS ps for the start in UTC and the C locale', async () => {
  // Arrange
  const query = answeringQuery({ stdout: 'Mon Oct  5 09:12:33 2026\n' })
  // Act
  const start = await readProcessStart(ID_OF_NO_PROCESS, {
    platform: 'darwin',
    run: query.run,
  })
  // Assert
  assert.equal(start, 'ps:Mon Oct  5 09:12:33 2026')
  assert.deepEqual(query.calls, [
    {
      file: '/bin/ps',
      queryArguments: ['-o', 'lstart=', '-p', '4194305'],
      options: {
        timeout: 3_000,
        maxBuffer: 1_024,
        killSignal: 'SIGKILL',
        windowsHide: true,
        env: { LC_ALL: 'C', TZ: 'UTC' },
      },
    },
  ])
})

// Value: protects=an error text or a hang never becomes an identity; fails_when=any such answer is returned as a start, or a failing query throws; why_new=probe: a missing pid prints a localized error (ER-1); seam=the injected platform and query runner
test('gives no start when ps or PowerShell fails, answers nothing, times out or answers a localized error text', async () => {
  // Arrange
  const endedWithAnError = Object.assign(new Error('Command failed'), {
      code: 1,
    }),
    ranTooLong = Object.assign(new Error('Command failed'), {
      killed: true,
      signal: 'SIGKILL',
    })
  const startOf = (
    platform: 'darwin' | 'win32',
    answer: { stdout: string } | Error,
  ): Promise<string | undefined> =>
    readProcessStart(ID_OF_NO_PROCESS, {
      platform,
      run: answeringQuery(answer).run,
    })
  // Act
  const starts = {
    psFailed: await startOf('darwin', endedWithAnError),
    psRanTooLong: await startOf('darwin', ranTooLong),
    psAnsweredNothing: await startOf('darwin', { stdout: '\n' }),
    psAnsweredTwoLines: await startOf('darwin', {
      stdout: 'Mon Oct  5 09:12:33 2026\nMon Oct  5 09:12:34 2026\n',
    }),
    psAnsweredInAnotherLocale: await startOf('darwin', {
      stdout: 'lun.  5 oct. 09:12:33 2026 à Paris\n',
    }),
    psAnswered65Characters: await startOf('darwin', {
      stdout: `${'M'.repeat(65)}\n`,
    }),
    powerShellFailed: await startOf('win32', endedWithAnError),
    powerShellRanTooLong: await startOf('win32', ranTooLong),
    powerShellAnsweredNothing: await startOf('win32', { stdout: '\r\n' }),
    powerShellAnsweredAnErrorText: await startOf('win32', {
      stdout:
        'Get-Process : Es kann kein Prozess mit der Prozess-ID 4194305 gefunden werden.\r\n',
    }),
    powerShellAnsweredALocalTime: await startOf('win32', {
      stdout: '2026-10-05T18:12:33.1234567+09:00\r\n',
    }),
    runnerThrewAtOnce: await readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'win32',
      run: () => {
        throw new Error('spawn powershell.exe ENOENT')
      },
    }),
  }
  // Assert
  assert.deepEqual(starts, {
    psFailed: undefined,
    psRanTooLong: undefined,
    psAnsweredNothing: undefined,
    psAnsweredTwoLines: undefined,
    psAnsweredInAnotherLocale: undefined,
    psAnswered65Characters: undefined,
    powerShellFailed: undefined,
    powerShellRanTooLong: undefined,
    powerShellAnsweredNothing: undefined,
    powerShellAnsweredAnErrorText: undefined,
    powerShellAnsweredALocalTime: undefined,
    runnerThrewAtOnce: undefined,
  })
})

// Value: protects=a Windows pid is told by its creation time, asked of the system's own PowerShell; fails_when=argv loses -NoProfile, -NonInteractive or the pid, the query opens a console window or loses its bounds, the ISO check is dropped, or the program is named without its path under the system root, so a powershell.exe in the editor's current directory or earlier in the search path is started in its place (Cycle 0046 row 107); why_new=new utility (ER-1); seam=the injected platform, environment and query runner. The real query runs in the Windows job.
test('reads a Windows start as UTC ISO text with a fixed command line, from the PowerShell under the system root', async () => {
  // Arrange
  const query = answeringQuery({ stdout: '2026-10-05T09:12:33.1234567Z\r\n' })
  // Act
  const start = await readProcessStart(ID_OF_NO_PROCESS, {
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows' },
    run: query.run,
  })
  // Assert
  assert.equal(start, 'win:2026-10-05T09:12:33.1234567Z')
  assert.deepEqual(query.calls, [
    {
      file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      queryArguments: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-Process -Id 4194305 -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')",
      ],
      options: {
        timeout: 3_000,
        maxBuffer: 1_024,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
    },
  ])
})

// Value: protects=the Windows query still runs where the system root is not known, and never from a path that is looked up from the current directory; fails_when=a missing, empty or relative SystemRoot makes the query fail or builds a relative path to PowerShell, or a root on another drive or with a trailing separator is refused (Cycle 0046 row 107); why_new=the program was started by its bare name alone; seam=the injected platform, environment and query runner
test('starts PowerShell by its bare name only where the system root is missing, empty or no absolute path, and by its full path for every root that is', async () => {
  // Arrange
  const programStartedWith = async (environment: {
    SystemRoot?: string
  }): Promise<string | undefined> => {
    const query = answeringQuery({ stdout: '2026-10-05T09:12:33.1234567Z\r\n' })
    await readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'win32',
      environment,
      run: query.run,
    })
    return query.calls[0]?.file
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

// Value: protects=a caller that can wait longer than the product for one query, as the tests that judge real processes do on a Windows runner whose first PowerShell starts cold; fails_when=the bound of a start query is fixed in the reader, so those tests depend on a cold PowerShell answering within the product's 3 s, or a named bound changes the query's other limits (Cycle 0046 row 105); why_new=the bound was no input; seam=the injected platform and query runner
test('a start query runs for as long as its caller allows, on macOS and on Windows, and for the product’s 3 s when the caller names no bound', async () => {
  // Arrange
  const optionsOfQuery = async (
    platform: 'darwin' | 'win32',
    queryTimeoutMs?: number,
  ): Promise<object | undefined> => {
    const query = answeringQuery({ stdout: 'Mon Oct  5 09:12:33 2026\n' })
    await readProcessStart(ID_OF_NO_PROCESS, {
      platform,
      run: query.run,
      queryTimeoutMs,
    })
    return query.calls[0]?.options
  }
  // Act
  const options = {
    macWith30Seconds: await optionsOfQuery('darwin', 30_000),
    windowsWith30Seconds: await optionsOfQuery('win32', 30_000),
    windowsWithoutABound: await optionsOfQuery('win32'),
  }
  // Assert
  assert.deepEqual(options, {
    macWith30Seconds: {
      timeout: 30_000,
      maxBuffer: 1_024,
      killSignal: 'SIGKILL',
      windowsHide: true,
      env: { LC_ALL: 'C', TZ: 'UTC' },
    },
    windowsWith30Seconds: {
      timeout: 30_000,
      maxBuffer: 1_024,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
    windowsWithoutABound: {
      timeout: 3_000,
      maxBuffer: 1_024,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
  })
})

// Value: protects=a failed run of the real-process tests says what failed: the read of a start, by which query; fails_when=a start the system did not name within the tests' bound is handed on as no start, so the tests that follow fail as wrong judgements ("Learning storage is locked …", "false !== true") with no word about the read (Cycle 0046 row 105); why_new=the tests read real starts under the product's bound and said nothing when it failed; seam=the injected platform and query runner
test('a real start that the system does not name fails the test that needs it with a sentence that names the query, and one it names is handed on', async () => {
  // Arrange: a PowerShell that runs into its bound, a ps that fails, a stat that cannot be read, a platform without a query, and a PowerShell that answers.
  const ranTooLong = Object.assign(new Error('Command failed'), {
    killed: true,
    signal: 'SIGKILL',
  })
  const messageOf = (inputs: ProcessStartInputs): Promise<string> =>
    realProcessStart(ID_OF_NO_PROCESS, inputs).then(
      (start) => `read ${start}`,
      (error: Error) => error.message,
    )
  const answering = answeringQuery({
    stdout: '2026-10-05T09:12:33.1234567Z\r\n',
  })
  // Act
  const outcomes = {
    windows: await messageOf({
      platform: 'win32',
      run: answeringQuery(ranTooLong).run,
    }),
    mac: await messageOf({
      platform: 'darwin',
      run: answeringQuery(ranTooLong).run,
    }),
    linux: await messageOf({
      platform: 'linux',
      readFile: async () => {
        throw new Error('ENOENT: no such file or directory')
      },
    }),
    anotherPlatform: await messageOf({ platform: 'freebsd' }),
    answered: await messageOf({ platform: 'win32', run: answering.run }),
  }
  // Assert
  assert.deepEqual(outcomes, {
    windows:
      'The start of process 4194305 could not be read: the PowerShell query (Get-Process -Id <pid>).StartTime, started from %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe gave no start within 30 s. The tests that judge a real process need it.',
    mac: 'The start of process 4194305 could not be read: the query /bin/ps -o lstart= -p <pid> gave no start within 30 s. The tests that judge a real process need it.',
    linux:
      'The start of process 4194305 could not be read: the read of /proc/<pid>/stat gave no start within 30 s. The tests that judge a real process need it.',
    anotherPlatform:
      'The start of process 4194305 could not be read: a platform that has no start query (freebsd) gave no start within 30 s. The tests that judge a real process need it.',
    answered: 'read win:2026-10-05T09:12:33.1234567Z',
  })
  assert.deepEqual(
    answering.calls.map((call) => call.options),
    [
      {
        timeout: 30_000,
        maxBuffer: 1_024,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
    ],
  )
})

// Value: protects=a hostile record cannot reach a path or a command line; fails_when=NaN, 0, -1, 1.5 or 2**53 reaches the file read or the runner, or an unknown platform runs a query; why_new=new utility (ER-1); seam=the injected platform, file read and query runner
test('never gives a pid that is not a positive integer to a command, and gives no start on another platform', async () => {
  // Arrange
  const query = answeringQuery({ stdout: '2026-10-05T09:12:33.1234567Z\r\n' })
  const readPaths: string[] = []
  const readFile = async (path: string): Promise<string> => {
    readPaths.push(path)
    return linuxStat(200)
  }
  const starts: (string | undefined)[] = []
  // Act
  for (const platform of ['linux', 'darwin', 'win32'] as const)
    for (const pid of [Number.NaN, 0, -1, 1.5, 2 ** 53, Infinity])
      starts.push(
        await readProcessStart(pid, { platform, readFile, run: query.run }),
      )
  const startOnAnotherPlatform = await readProcessStart(ID_OF_NO_PROCESS, {
    platform: 'freebsd',
    readFile,
    run: query.run,
  })
  // Assert
  assert.deepEqual(starts, Array(18).fill(undefined))
  assert.equal(startOnAnotherPlatform, undefined)
  assert.deepEqual(readPaths, [])
  assert.deepEqual(query.calls, [])
})

// Value: protects=several records of one running window cost one read in a sweep; fails_when=a kept start that equals the recorded one is read again; why_new=the cache is new (ER-12, decision D7); seam=the injected platform and file read
test('a start kept for a sweep confirms a record of the same start without a second read', async () => {
  // Arrange: a process other than this one began at tick 200, and a sweep meets two records that name that start.
  let reads = 0
  const sweep: ProcessStartInputs = {
    platform: 'linux',
    readFile: async () => {
      reads += 1
      return linuxStat(200)
    },
    readLink: inNamespace4026531836,
    cache: new Map(),
    expectedStart: 'linux@4026531836:200',
  }
  // Act
  const atTheFirstRecord = await readProcessStart(ID_OF_NO_PROCESS, sweep),
    atTheSecondRecord = await readProcessStart(ID_OF_NO_PROCESS, sweep)
  // Assert
  assert.equal(atTheFirstRecord, 'linux@4026531836:200')
  assert.equal(atTheSecondRecord, 'linux@4026531836:200')
  assert.equal(reads, 1)
})

// Value: protects=a pid that went to another process between two looks is never judged by the earlier process's start; fails_when=a kept start that differs from the recorded one is answered without a read, so the live owner of the second look counts as gone; why_new=the cache is new (ER-12); seam=the injected platform and file read
test('a start kept for a sweep that differs from the recorded one is read again', async () => {
  // Arrange: at the first look the process with the id began at tick 200; before the second look that process ended and another one got the id, begun at tick 300.
  const stats = [linuxStat(200), linuxStat(300)]
  let reads = 0
  const cache = new Map<number, Promise<string | undefined>>()
  const look = (expectedStart: string): Promise<string | undefined> =>
    readProcessStart(ID_OF_NO_PROCESS, {
      platform: 'linux',
      readFile: async () => stats[reads++] ?? linuxStat(300),
      readLink: inNamespace4026531836,
      cache,
      expectedStart,
    })
  // Act
  const atTheFirstLook = await look('linux@4026531836:100'),
    atTheSecondLook = await look('linux@4026531836:300')
  // Assert
  assert.equal(atTheFirstLook, 'linux@4026531836:200')
  assert.equal(atTheSecondLook, 'linux@4026531836:300')
  assert.equal(reads, 2)
})

// Value: protects=the real read is stable and tells two processes apart; fails_when=the real answer changes between two reads, two processes share one, or the platform's answer is refused by its own check; why_new=only a real read shows it (decision D6); seam=none (two real child processes)
test('names a running process by a start that stays the same and differs from another process’s', async (context) => {
  // Arrange: two processes started more than a second apart, which is the coarsest step a platform's answer has (`ps` prints whole seconds).
  const earlier = await idleChild(context)
  await delay(1_100)
  const later = await idleChild(context)
  // Act
  const startOfEarlier = await realProcessStart(earlier.pid!),
    startOfEarlierAgain = await realProcessStart(earlier.pid!),
    startOfLater = await realProcessStart(later.pid!)
  // Assert
  assert.match(startOfEarlier, /^(linux@\d+|linux|ps|win):./)
  assert.match(startOfLater, /^(linux@\d+|linux|ps|win):./)
  assert.equal(startOfEarlierAgain, startOfEarlier)
  assert.notEqual(startOfLater, startOfEarlier)
})

// Value: protects=the real Linux start names the pid namespace this process really is in, so two WSL distributions of one computer, or a container and its host, never take each other's records for their own; fails_when=the real read gives a start without a namespace, or with another number than the kernel names for this process (Cycle 0046 row 65); why_new=only a real read shows it; seam=none (a real child process and the kernel's own link). Linux only: no other system has pid namespaces.
test(
  'the start read for a real child process carries the pid namespace of this process',
  {
    skip: process.platform !== 'linux' && 'pid namespaces exist on Linux only',
  },
  async (context) => {
    // Arrange: what the kernel names as this process's pid namespace, "pid:[<number>]".
    const child = await idleChild(context)
    const namespaceNumber = readlinkSync('/proc/self/ns/pid').slice(
      'pid:['.length,
      -']'.length,
    )
    // Act
    const start = await realProcessStart(child.pid!)
    // Assert
    assert.match(namespaceNumber, /^\d+$/)
    assert.equal(start.slice(0, start.indexOf(':')), `linux@${namespaceNumber}`)
  },
)

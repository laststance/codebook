import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'

import type { ListenerTool } from '../utils/listenerToolPath'
import { listenerToolPath } from '../utils/listenerToolPath'
import { readPortListeners } from '../utils/readPortListeners'
import type { BoundedQueryRunner } from '../utils/runBoundedQuery'

const LSOF: ListenerTool = { kind: 'lsof', path: '/usr/sbin/lsof' }
const SS: ListenerTool = { kind: 'ss', path: '/usr/bin/ss' }

/**
 * Builds a runner that records its calls and answers the same output or rejects with the same failure, in place of `lsof` or `ss`.
 * @param answer - What the tool prints, or the failure it ends with.
 * @returns The runner and its recorded calls.
 * @example answeringTool({ stdout: 'p1\nf3\ntIPv4\nn127.0.0.1:4100\n' })
 */
function answeringTool(answer: { stdout: string } | Error): {
  run: BoundedQueryRunner
  calls: { file: string; queryArguments: string[]; timeout: number }[]
} {
  const calls: { file: string; queryArguments: string[]; timeout: number }[] =
    []
  return {
    calls,
    run: async (file, queryArguments, options) => {
      calls.push({ file, queryArguments, timeout: options.timeout })
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

test('the listener tool on macOS is lsof at its system path and never a Homebrew ss', async () => {
  // protects: ownership answered only by system programs; fails_when: a search-path or Homebrew program is chosen; no_claim: lsof's output.
  // Arrange
  const looked: string[] = []
  const isProgramFile = async (path: string): Promise<boolean> => {
    looked.push(path)
    return path === '/usr/bin/ss' || path === '/usr/bin/lsof'
  }
  // Act
  const tool = await listenerToolPath({ platform: 'darwin', isProgramFile })
  // Assert
  assert.deepEqual(tool, { kind: 'lsof', path: '/usr/bin/lsof' })
  assert.deepEqual(looked, ['/usr/sbin/lsof', '/usr/bin/lsof'])
})

test('the listener tool on Linux without lsof is ss at a system path, and native Windows has none', async () => {
  // protects: the Linux fallback and the Windows prerequisite; fails_when: ss is skipped on Linux or a tool is named on win32; no_claim: none.
  // Arrange
  const isProgramFile = async (path: string): Promise<boolean> =>
    path === '/usr/sbin/ss'
  // Act
  const linux = await listenerToolPath({ platform: 'linux', isProgramFile })
  const macos = await listenerToolPath({ platform: 'darwin', isProgramFile })
  const windows = await listenerToolPath({
    platform: 'win32',
    isProgramFile: async () => true,
  })
  // Assert
  assert.deepEqual(linux, { kind: 'ss', path: '/usr/sbin/ss' })
  assert.equal(macos, undefined)
  assert.equal(windows, undefined)
})

test('a port held by a dual-stack server and a loopback IPv4 server reads both listeners with their processes', async () => {
  // protects: the IPv6-owned / IPv4-foreign case the run must refuse; fails_when: a socket record is dropped or merged; no_claim: the ownership decision (pt2).
  // Arrange
  const tool = answeringTool({
    stdout: 'p48633\nf18\ntIPv6\nn*:4100\np51000\nf7\ntIPv4\nn127.0.0.1:4100\n',
  })
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'read',
    tool: 'lsof',
    listeners: [
      { family: 'IPv6', address: '*', port: 4100, pid: 48633 },
      { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 51000 },
    ],
  })
  assert.deepEqual(tool.calls, [
    {
      file: '/usr/sbin/lsof',
      queryArguments: ['-nP', '-iTCP:4100', '-sTCP:LISTEN', '-Fptn'],
      timeout: 3_000,
    },
  ])
})

test('lsof exiting 1 without a word reads as no listener on the port', async () => {
  // protects: a free port is not "owner unknown"; fails_when: lsof's silent exit 1 becomes unknown; no_claim: none.
  // Arrange
  const tool = answeringTool(
    Object.assign(new Error('Command failed'), {
      code: 1,
      stdout: '',
      stderr: '',
    }),
  )
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, { kind: 'read', tool: 'lsof', listeners: [] })
})

test('a listener query that runs past 3 seconds leaves the port owner unknown', async () => {
  // protects: PORT_OWNER_UNKNOWN's bound; fails_when: a hung tool counts as no listener; no_claim: the error code mapping (pt2).
  // Arrange
  const tool = answeringTool(
    Object.assign(new Error('Command failed'), {
      killed: true,
      signal: 'SIGKILL',
      code: null,
    }),
  )
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'unknown',
    reason: 'lsof did not answer within 3 s.',
  })
})

test('a failing or missing listener tool leaves the port owner unknown with its reason', async () => {
  // protects: unknown never passes for "no listener"; fails_when: a failure or a missing tool reads as empty; no_claim: none.
  // Arrange
  const failing = answeringTool(
    Object.assign(new Error('Command failed'), {
      code: 2,
      stdout: '',
      stderr: 'lsof: unsupported option\n',
    }),
  )
  // Act
  const failed = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: failing.run,
  })
  const missing = await readPortListeners(4100, {
    findTool: async () => undefined,
  })
  // Assert
  assert.deepEqual(failed, {
    kind: 'unknown',
    reason: 'lsof failed: lsof: unsupported option.',
  })
  assert.deepEqual(missing, {
    kind: 'unknown',
    reason:
      'No lsof lies at /usr/sbin/lsof or /usr/bin/lsof (on Linux, no ss at /usr/bin/ss, /bin/ss, /usr/sbin/ss or /sbin/ss), and Codebook starts them only from there.',
  })
})

test('ss on Linux reads each listening socket with its processes, and another user socket without a pid', async () => {
  // protects: the Linux reading; fails_when: a forked holder, an IPv6 wildcard or a foreign user's socket is misread; no_claim: ss's exact column widths.
  // Arrange
  const tool = answeringTool({
    stdout: [
      'LISTEN 0      511          *:4100            *:*    users:(("node",pid=1234,fd=18),("node",pid=1240,fd=18))',
      'LISTEN 0      4096   127.0.0.1:4100      0.0.0.0:*',
      'LISTEN 0      511      [::1]:4100         [::]:*    users:(("node",pid=1234,fd=19))',
      '',
    ].join('\n'),
  })
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => SS,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'read',
    tool: 'ss',
    listeners: [
      { family: 'IPv6', address: '*', port: 4100, pid: 1234 },
      { family: 'IPv6', address: '*', port: 4100, pid: 1240 },
      { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: undefined },
      { family: 'IPv6', address: '::1', port: 4100, pid: 1234 },
    ],
  })
  assert.deepEqual(tool.calls[0]?.queryArguments, [
    '-H',
    '-l',
    '-t',
    '-n',
    '-p',
    'sport',
    '=',
    ':4100',
  ])
})

test('a listener line the reader does not understand leaves the port owner unknown', async () => {
  // protects: no ownership decision on a misread answer; fails_when: a garbled line is skipped silently; no_claim: none.
  // Arrange
  const tool = answeringTool({ stdout: 'p48633\nf18\ntIPv6\nn*:http\n' })
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'unknown',
    reason: 'lsof printed a listener line Codebook cannot read.',
  })
})

test('the system listener tool names this process as the listener of a dual-stack server it started', async (t) => {
  // protects: the real lsof or ss reading on the machine; fails_when: the real output no longer parses or names another process; no_claim: a foreign user's socket.
  // Arrange
  const tool = await listenerToolPath()
  if (!tool) {
    t.skip('no lsof or ss lies at a system path on this machine')
    return
  }
  const server = createServer()
  server.listen(0, '::')
  await once(server, 'listening')
  t.after(() => server.close())
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const { port } = address
  // Act
  const reading = await readPortListeners(port)
  // Assert
  assert.equal(reading.kind, 'read')
  assert.deepEqual(
    reading.kind === 'read'
      ? reading.listeners.map((listener) => ({
          port: listener.port,
          pid: listener.pid,
        }))
      : [],
    [{ port, pid: process.pid }],
  )
})

// Value: protects=bracketed IPv6 and zone-scoped listener addresses read as the bare address in the IPv6 family; fails_when=brackets or the %zone stay in the address, or the family is lost, so an owned IPv6 listener reads as foreign; why_new=existing rows cover only the wildcard, 127.0.0.1 and ::1 in ss; seam=none; no_claim=real lsof output (stubbed runner; unit only)
test('lsof reads a link-local IPv6 listener with its zone removed and a bracketed loopback unchanged', async () => {
  // Arrange
  const tool = answeringTool({
    stdout: 'p100\nf5\ntIPv6\nn[fe80::1%lo0]:4100\nf6\ntIPv6\nn[::1]:4100\n',
  })
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => LSOF,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'read',
    tool: 'lsof',
    listeners: [
      { family: 'IPv6', address: 'fe80::1', port: 4100, pid: 100 },
      { family: 'IPv6', address: '::1', port: 4100, pid: 100 },
    ],
  })
})

// Value: protects=a listener answer that is malformed, oversized or an lsof failure with a message never reads as "no listener" or a guessed owner; fails_when=an out-of-range port, a socket before its family, a non-numeric pid, a non-LISTEN ss row, an oversized answer or lsof exit 1 with stderr is skipped or read as empty; why_new=existing rows cover only a named-service port and exit 1 without a word; seam=none; no_claim=the port-owner error code mapping (pt2; stubbed runner)
test('a malformed, oversized or noisy listener answer leaves the port owner unknown with its own reason', async () => {
  // Arrange
  const unreadableLsof = (stdout: string) => ({ stdout })
  const cases: {
    tool: ListenerTool
    answer: { stdout: string } | Error
    reason: string
  }[] = [
    {
      tool: LSOF,
      answer: unreadableLsof('p48633\nf18\ntIPv4\nn127.0.0.1:70000\n'),
      reason: 'lsof printed a listener line Codebook cannot read.',
    },
    {
      tool: LSOF,
      answer: unreadableLsof('p48633\nf18\nn127.0.0.1:4100\n'),
      reason: 'lsof printed a listener line Codebook cannot read.',
    },
    {
      tool: LSOF,
      answer: unreadableLsof('pabc\nf18\ntIPv4\nn127.0.0.1:4100\n'),
      reason: 'lsof printed a listener line Codebook cannot read.',
    },
    {
      tool: SS,
      answer: {
        stdout: 'ESTAB 0      0      127.0.0.1:4100   127.0.0.1:5000\n',
      },
      reason: 'ss printed a listener line Codebook cannot read.',
    },
    {
      tool: LSOF,
      answer: Object.assign(new Error('Command failed'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
      reason: 'lsof printed more than 1048576 bytes.',
    },
    {
      tool: LSOF,
      answer: Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: '',
        stderr: "lsof: WARNING: can't stat() fuse file system\n",
      }),
      reason: "lsof failed: lsof: WARNING: can't stat() fuse file system.",
    },
  ]
  // Act
  const readings = []
  for (const { tool, answer } of cases)
    readings.push(
      await readPortListeners(4100, {
        findTool: async () => tool,
        run: answeringTool(answer).run,
      }),
    )
  // Assert
  assert.deepEqual(
    readings,
    cases.map(({ reason }) => ({ kind: 'unknown', reason })),
  )
})

// Value: protects=an older ss that prints IPv6 local addresses without brackets (`:::4100`, `::1:4100`) still reads them in the IPv6 family; fails_when=the family is taken from a leading bracket only, so an owned IPv6 listener reads as IPv4 and the ownership check compares the wrong family; why_new=existing ss rows are all bracketed or `*`; seam=none; no_claim=every iproute2 release's exact columns (stubbed runner; unit only)
test('an older ss that prints IPv6 addresses without brackets reads them as IPv6 listeners', async () => {
  // Arrange
  const tool = answeringTool({
    stdout: [
      'LISTEN     0      128         :::4100         :::*    users:(("node",pid=1234,fd=18))',
      'LISTEN     0      128       ::1:4100         :::*    users:(("node",pid=1234,fd=19))',
      'LISTEN     0      128  127.0.0.1:4100   0.0.0.0:*    users:(("node",pid=1234,fd=20))',
      '',
    ].join('\n'),
  })
  // Act
  const reading = await readPortListeners(4100, {
    findTool: async () => SS,
    run: tool.run,
  })
  // Assert
  assert.deepEqual(reading, {
    kind: 'read',
    tool: 'ss',
    listeners: [
      { family: 'IPv6', address: '::', port: 4100, pid: 1234 },
      { family: 'IPv6', address: '::1', port: 4100, pid: 1234 },
      { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 1234 },
    ],
  })
})

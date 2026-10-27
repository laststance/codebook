import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { assertDevelopmentWorkspace } from '../utils/assertDevelopmentWorkspace'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'
import type * as ServerModule from '../utils/launchDevelopmentServer'
import { ownedDevelopmentPortState } from '../utils/ownedDevelopmentPorts'

test('development readiness waits for a complete port across process output chunks', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    requestedOrigins: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      fetch: async (origin: string) => {
        requestedOrigins.push(origin)
        return { ok: true }
      },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from('Local: http://127.0.0.1:43'),
              )
              assert.equal(
                read(),
                undefined,
                'A partial port cannot start the readiness request.',
              )
              child.stdout.emit('data', Buffer.from('217'))
              assert.equal(
                read(),
                undefined,
                'The port must have a received terminator.',
              )
              child.stdout.emit('data', Buffer.from('\nReady'))
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    43217,
  )
  // Act
  const origin = await server.ready(new AbortController().signal)
  // Assert
  assert.equal(origin, 'http://127.0.0.1:43217')
  assert.deepEqual(requestedOrigins, ['http://127.0.0.1:43217'])
})

// Value: protects=readiness names the declared port's origin even when the server's log prints another local URL first (F552); fails_when=the first 127.0.0.1 URL in the log is taken and the run opens the wrong application; why_new=F552 (Step 11, third round); seam=the launcher run in an isolated module context with a stub child and waitUntil; no_claim=a real next dev process
test('readiness takes the declared port origin when the log prints another local URL first', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    requestedOrigins: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42002,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      fetch: async (origin: string) => {
        requestedOrigins.push(origin)
        return { ok: true }
      },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from(
                  'proxy: http://127.0.0.1:5555/api\nLocal: http://127.0.0.1:43217\nReady',
                ),
              )
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  const server = exports.launchDevelopmentServer!(
    '/isolated-target',
    '/node',
    () => {},
    false,
    43217,
  )

  // Act
  const origin = await server.ready(new AbortController().signal)

  // Assert
  assert.equal(origin, 'http://127.0.0.1:43217')
  assert.deepEqual(requestedOrigins, ['http://127.0.0.1:43217'])
})

// Value: protects=the repository-browser run starts the app on the port the project declares (F411, D63), so its pinned auth origin stays reachable; fails_when=the spawned next dev still gets `--port 0` or a port other than the declared one; why_new=N50's run started on 53273 while AUTH_URL pointed to 3165; seam=the launcher run in an isolated module context with a recording spawn; no_claim=a real next dev process or the Auth.js redirect, which the native R2 run reads
test('the app starts on the declared port and on no other', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  let spawnedArguments: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process')
          return {
            spawn: (_node: string, argumentsList: string[]) => {
              spawnedArguments = argumentsList
              return child
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)

  // Act
  exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3165,
  )

  // Assert
  assert.deepEqual(Array.from(spawnedArguments.slice(1)), [
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3165',
  ])
})

test('shutdown kills surviving workers even when the process group leader already exited', async (context) => {
  // Arrange: only the leader honors TERM; its worker disappears only after group KILL.
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    signals: (string | number | undefined)[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: 0,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let groupAlive = true
  // The closer signals through the shared process-group utilities, which use the real process: no signal of this test leaves it.
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      assert.equal(pid, -42000)
      signals.push(signal)
      if (signal === 'SIGTERM') child.emit('exit')
      if (signal === 'SIGKILL') groupAlive = false
      if (signal === 0 && !groupAlive)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown): Promise<void> => {
              if (!(await read())) throw new Error('Group deadline exceeded')
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3000,
  )
  // Act
  await server.close()
  // Assert
  assert.deepEqual(signals, ['SIGTERM', 0, 'SIGKILL', 0])
  assert.equal(groupAlive, false)
})

test('a later stop retries an application signal failure instead of replaying its rejected promise', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: 0,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let termCount = 0
  // The closer signals through the shared process-group utilities, which use the real process: no signal of this test leaves it.
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      if (signal === 0)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      if (signal === 'SIGTERM' && ++termCount === 1)
        throw new Error('Transient process signal failure')
      child.emit('exit')
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        return name === 'node:child_process'
          ? { spawn: () => child }
          : nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3000,
  )
  // Act
  await assert.rejects(server.close(), /Transient process signal failure/)
  await server.close()
  // Assert
  assert.equal(termCount, 2)
})

// Value: protects=a failed stop keeps the port claimed as stopping and only the retried stop that succeeds frees it, so a new run is never told the port is free while the old group may still hold it; fails_when=close() releases the claim before the exit is verified, or never releases it after the retry; why_new=F534 (test gap of the F425 release order); seam=the launcher run in an isolated module context with a recording process.kill, reading the real claim registry; no_claim=a real next dev process or the port check of a following run
test('a failed stop leaves the port claimed as stopping and the retried stop frees it', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: 0,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  const port = 39341
  let termCount = 0
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      if (signal === 0)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      if (signal === 'SIGTERM' && ++termCount === 1)
        throw new Error('Transient process signal failure')
      child.emit('exit')
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        return name === 'node:child_process'
          ? { spawn: () => child }
          : nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    port,
  )
  assert.equal(ownedDevelopmentPortState(port), 'running')

  // Act
  await assert.rejects(server.close(), /Transient process signal failure/)
  const afterFailedStop = ownedDevelopmentPortState(port)
  await server.close()
  const afterRetriedStop = ownedDevelopmentPortState(port)

  // Assert
  assert.equal(afterFailedStop, 'stopping')
  assert.equal(afterRetriedStop, undefined)
})

// Cycle 0044 (0041-F2): red while the closer accepted only ESRCH, so macOS's EPERM for an exited, unreaped member rejected close() with "kill EPERM".
test('stopping the application resolves while macOS still answers its exited, unreaped group with EPERM', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: 0,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  context.mock.property(process, 'platform', 'darwin')
  let unreapedAnswers = 2
  // The closer signals through the shared process-group utilities, which use the real process: no signal of this test leaves it.
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      // macOS answers EPERM to every signal, signal 0 included, until the exited members are reaped.
      if (unreapedAnswers > 0) {
        unreapedAnswers -= 1
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      }
      if (signal === 0)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      child.emit('exit')
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        return name === 'node:child_process'
          ? { spawn: () => child }
          : nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3000,
  )
  child.emit('exit')
  // Act
  const stopping = server.close()
  // Assert
  await assert.doesNotReject(stopping)
  assert.equal(unreapedAnswers, 0)
})

test('server inspection is opt-in and waits for complete stderr identity without accepting stdout lookalikes', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    launches: string[][] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      Error,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process')
          return {
            spawn: (_node: string, arguments_: string[]) => {
              launches.push(arguments_)
              return child
            },
          }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from(
                  'Debugger listening on ws://127.0.0.1:49999/99999999-9999-4999-8999-999999999999\n',
                ),
              )
              assert.equal(read(), undefined)
              child.stderr.emit(
                'data',
                Buffer.from(
                  'Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
                ),
              )
              assert.equal(read(), undefined)
              child.stderr.emit('data', Buffer.from('\n'))
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const ordinary = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3000,
  )
  // Act / Assert
  await assert.rejects(
    ordinary.inspectorEndpoint(new AbortController().signal),
    /inspection was not requested/,
  )
  assert.equal(launches[0]?.includes('--inspect'), false)
  const inspected = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    true,
    3000,
  )
  assert.equal(
    await inspected.inspectorEndpoint(new AbortController().signal),
    'ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
  )
  assert.equal(launches[1]?.slice(-2).join(' '), '--inspect 127.0.0.1:0')
})

test('competing inspector announcements and an exited application cannot reuse an earlier endpoint', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  let exitCode: number | null = null
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  Object.defineProperty(child, 'exitCode', { get: () => exitCode })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      Error,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const inspected = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    true,
    3000,
  )
  child.stderr.emit(
    'data',
    Buffer.from(
      'Debugger listening on ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111\n',
    ),
  )
  assert.equal(
    await inspected.inspectorEndpoint(new AbortController().signal),
    'ws://127.0.0.1:43210/11111111-1111-4111-8111-111111111111',
  )
  // Act / Assert
  child.stderr.emit(
    'data',
    Buffer.from(
      'Debugger listening on ws://127.0.0.1:43211/22222222-2222-4222-8222-222222222222\n',
    ),
  )
  await assert.rejects(
    inspected.inspectorEndpoint(new AbortController().signal),
    /Ambiguous server inspector endpoints/,
  )
  exitCode = 0
  await assert.rejects(
    inspected.inspectorEndpoint(new AbortController().signal),
    /Application stopped/,
  )
})

test('an application without a root page is ready through its selected entry path', async () => {
  // Arrange: "/" answers 404 while the configured "/login" entry renders.
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    requestedUrls: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      fetch: async (url: string) => {
        requestedUrls.push(url)
        return {
          ok: url.endsWith('/login'),
          status: url.endsWith('/login') ? 200 : 404,
        }
      },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from('Local: http://127.0.0.1:43217\nReady'),
              )
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    43217,
  )

  // Act
  const origin = await server.ready(new AbortController().signal, '/login')

  // Assert
  assert.equal(origin, 'http://127.0.0.1:43217')
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:43217/login'])
})

test('a selected entry path that redirects to sign-in does not count as a ready application', async () => {
  // Arrange: the configured "/dashboard" entry answers 307 to a sign-in page.
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    requests: Array<{ url: string; redirect?: string }> = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      fetch: async (url: string, init: { redirect?: string }) => {
        requests.push({ url, redirect: init.redirect })
        return { ok: false, status: 307 }
      },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from('Local: http://127.0.0.1:43217\nReady'),
              )
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    43217,
  )

  // Act
  const ready = server.ready(new AbortController().signal, '/dashboard')

  // Assert
  await assert.rejects(
    ready,
    /Selected application page failed or redirected: 307/,
  )
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217/dashboard', redirect: 'manual' },
  ])
})

test('an application whose root page fails is not ready when the root is its entry', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {}
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      fetch: async () => ({ ok: false, status: 500 }),
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown) => {
              child.stdout.emit(
                'data',
                Buffer.from('Local: http://127.0.0.1:43217\nReady'),
              )
              return read()
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    () => {},
    false,
    3000,
  )

  // Act
  const ready = server.ready(new AbortController().signal)

  // Assert
  await assert.rejects(ready, /Application root failed: 500/)
})

// Value: protects=a second real development run after Stop; fails_when=Next's 100ms parent grace kills its still-cleaning worker and leaves .next/dev/lock, although Codebook reports resources released; why_new=Cycle0046 row376, native Cursor407/411; seam=real parent/worker processes and the product launch/close/prerequisite APIs.
/** Asks the system for a free loopback port and releases it, for a launcher whose readiness must match the port it was given. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test('a stopped development server lets its worker release the build lock before another run checks the workspace', async (context) => {
  // Arrange: the Next-shaped parent has its actual default100ms child cutoff; the worker needs250ms to release its native lock after TERM.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-next-shutdown-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const nextDirectory = join(directory, 'node_modules/next/dist/bin')
  await mkdir(nextDirectory, { recursive: true })
  await writeFile(
    join(nextDirectory, 'next'),
    String.raw`
const { spawn } = require('node:child_process');
const path = require('node:path');
const worker = spawn(process.execPath, [path.join(__dirname, 'worker.cjs'), process.argv[process.argv.indexOf('--port') + 1]], { stdio: ['ignore', 'inherit', 'inherit'] });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  worker.kill('SIGTERM');
  const cutoff = setTimeout(() => worker.kill('SIGKILL'), Number(process.env.NEXT_EXIT_TIMEOUT_MS || '100'));
  worker.once('exit', () => { clearTimeout(cutoff); process.exit(0); });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', () => worker.kill('SIGKILL'));
`,
  )
  await writeFile(
    join(nextDirectory, 'worker.cjs'),
    String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lock = path.join(process.cwd(), '.next/dev/lock');
fs.mkdirSync(path.dirname(lock), { recursive: true });
fs.writeFileSync(lock, '');
const server = http.createServer((request, response) => { response.writeHead(200); response.end('ready'); });
server.listen(Number(process.argv[2]), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port));
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  server.close();
  setTimeout(() => { fs.unlinkSync(lock); process.exit(0); }, 250);
});
`,
  )
  const server = launchDevelopmentServer(
    directory,
    process.execPath,
    () => {},
    false,
    await freePort(),
  )
  context.after(() => server.close())
  await server.ready(new AbortController().signal, '/login')
  assert.equal((await stat(join(directory, '.next/dev/lock'))).isFile(), true)

  // Act: the product signals its owned group and waits for all workers and the listener.
  await server.close()

  // Assert: the next ordinary prerequisite check succeeds without deleting or reusing a foreign lock.
  await assert.doesNotReject(
    assertDevelopmentWorkspace(directory, new AbortController().signal),
  )
  await assert.rejects(stat(join(directory, '.next/dev/lock')), {
    code: 'ENOENT',
  })
})

// Value: protects=the redaction contract on the repository-browser dev server's output, which the run journals in application.closed and quotes in failure messages (pt1 red-team finding); fails_when=a credential the server prints, even split across chunks, reaches the journal or the readiness failure; why_new=no test fed the dev server's log through redaction; seam=the launcher run in an isolated module context with a stub child, as the other tests here; no_claim=a real next dev process
test('a credential the dev server prints, split across chunks, reads [masked] in the closed journal and in a readiness failure', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    journal: { type: string; detail: unknown }[] = []
  const token = ['ghp', '0123456789abcdefghijKLMNOPqrstuvwxyz'].join('_')
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null as number | null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let groupAlive = true
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      if (signal === 'SIGTERM') {
        groupAlive = false
        child.emit('exit')
      }
      if (signal === 0 && !groupAlive)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown): Promise<unknown> => {
              const value = await read()
              if (!value) throw new Error('not ready')
              return value
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    (type, detail) => journal.push({ type, detail }),
    false,
    3000,
  )
  child.stdout.emit('data', Buffer.from(`using token ${token.slice(0, 12)}`))
  child.stdout.emit('data', Buffer.from(`${token.slice(12)} for the api\n`))
  child.exitCode = 1
  // Act
  const failure = await server
    .ready(new AbortController().signal)
    .catch((error: unknown) => error)
  await server.close()
  // Assert
  // The launcher runs in its own realm, so its Error is read by its message, not by instanceof.
  const failureMessage =
    typeof failure === 'object' && failure !== null
      ? Reflect.get(failure, 'message')
      : undefined
  assert.equal(
    failureMessage,
    'Application exited: 1: using token [masked] for the api\n',
  )
  const closed = journal.find((entry) => entry.type === 'application.closed')
  assert.equal(
    JSON.stringify(closed?.detail).includes('using token [masked] for the api'),
    true,
  )
  assert.equal(JSON.stringify(journal).includes(token.slice(4, 20)), false)
})

// Value: protects=the dev server's stderr is redacted too, and a credential still held at a stream's end is masked when the stream ends (pt1 pass 2 testing finding); fails_when=stderr bypasses the redactor or the end flush releases the held token raw; why_new=the first redaction test drives stdout and the exit path only; seam=the launcher run in an isolated module context with a stub child; no_claim=a real next dev process
test('a credential the dev server prints last on stderr, without a line end, reads [masked] once the stream ends', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    journal: { type: string; detail: unknown }[] = []
  const token = ['ghp', 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210'].join('_')
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let groupAlive = true
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      if (signal === 'SIGTERM') {
        groupAlive = false
        child.emit('exit')
      }
      if (signal === 0 && !groupAlive)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown): Promise<unknown> => {
              const value = await read()
              if (!value) throw new Error('not ready')
              return value
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    (type, detail) => journal.push({ type, detail }),
    false,
    3000,
  )
  // Act
  child.stderr.emit(
    'data',
    Buffer.from(`fatal: bad credential ${token.slice(0, 9)}`),
  )
  child.stderr.emit('data', Buffer.from(token.slice(9)))
  child.stderr.emit('end')
  await server.close()
  // Assert
  const closed = journal.find((entry) => entry.type === 'application.closed')
  assert.equal(
    JSON.stringify(closed?.detail).includes('fatal: bad credential [masked]'),
    true,
  )
  assert.equal(JSON.stringify(journal).includes(token.slice(4, 20)), false)
})

// Value: protects=the closed journal carries the dev server's last held output, masked, even when the process exits before its stream ends (pt1 Step 11 Codex finding: the held tail was published only on the stream's end, after the journal); fails_when=the journal lacks the held text or carries it raw; why_new=the earlier tests end the stream before close; seam=the launcher run in an isolated module context with a stub child; no_claim=a real next dev process
test('the dev server output still held when it exits reaches the closed journal masked, before its stream ends', async (context) => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    journal: { type: string; detail: unknown }[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let groupAlive = true
  context.mock.method(
    process,
    'kill',
    (_pid: number, signal?: string | number): true => {
      if (signal === 'SIGTERM') {
        groupAlive = false
        child.emit('exit')
      }
      if (signal === 0 && !groupAlive)
        throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
      return true
    },
  )
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: { env: {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawn: () => child }
        if (name.endsWith('/utils/waitUntil'))
          return {
            waitUntil: async (read: () => unknown): Promise<unknown> => {
              const value = await read()
              if (!value) throw new Error('not ready')
              return value
            },
          }
        return nativeRequire(name)
      },
    },
    { filename },
  )
  assert.ok(exports.launchDevelopmentServer)
  const server = exports.launchDevelopmentServer(
    '/isolated-target',
    '/node',
    (type, detail) => journal.push({ type, detail }),
    false,
    3000,
  )
  // Act
  child.stderr.emit('data', Buffer.from(`fatal: ECONNRESET token ${'ghp'}_abc`))
  await server.close()
  // Assert
  const closed = journal.find((entry) => entry.type === 'application.closed')
  assert.equal(
    JSON.stringify(closed?.detail).includes('fatal: ECONNRESET token [masked]'),
    true,
  )
})

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type * as ServerModule from '../utils/launchDevelopmentServer'

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
  )
  // Act
  const origin = await server.ready(new AbortController().signal)
  // Assert
  assert.equal(origin, 'http://127.0.0.1:43217')
  assert.deepEqual(requestedOrigins, ['http://127.0.0.1:43217'])
})

test('shutdown kills surviving workers even when the process group leader already exited', async () => {
  // Arrange: only the leader honors TERM; its worker disappears only after group KILL.
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    signals: (string | number)[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 42000,
    exitCode: 0,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let groupAlive = true
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: {
        env: {},
        kill(pid: number, signal: string | number) {
          assert.equal(pid, -42000)
          signals.push(signal)
          if (signal === 'SIGTERM') child.emit('exit')
          if (signal === 'SIGKILL') groupAlive = false
          if (signal === 0 && !groupAlive)
            throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
        },
      },
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
  )
  // Act
  await server.close()
  // Assert
  assert.deepEqual(signals, ['SIGTERM', 0, 'SIGKILL', 0])
  assert.equal(groupAlive, false)
})

test('a later stop retries an application signal failure instead of replaying its rejected promise', async () => {
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
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      AbortSignal,
      Buffer,
      process: {
        env: {},
        kill(_pid: number, signal: string | number) {
          if (signal === 0)
            throw Object.assign(new Error('missing group'), { code: 'ESRCH' })
          if (signal === 'SIGTERM' && ++termCount === 1)
            throw new Error('Transient process signal failure')
          child.emit('exit')
        },
      },
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
  )
  // Act
  await assert.rejects(server.close(), /Transient process signal failure/)
  await server.close()
  // Assert
  assert.equal(termCount, 2)
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
  )

  // Act
  const ready = server.ready(new AbortController().signal)

  // Assert
  await assert.rejects(ready, /Application root failed: 500/)
})

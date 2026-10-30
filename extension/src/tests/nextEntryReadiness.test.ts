import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type * as ServerModule from '../utils/launchDevelopmentServer'

/** One request the stand-in `fetch` received: its URL and the redirect mode it was asked for. */
type RecordedRequest = { url: string; redirect?: string }

/** What the stand-in `fetch` answers for a URL: a status and, for a redirect, a `Location` header. */
type StandInResponse = { status: number; location?: string }

/**
 * Loads the real launcher in an isolated module context with a stub child that prints the listener line at once and a stand-in `fetch`, as the other launcher tests do.
 * @param answer - What the stand-in `fetch` answers for each URL.
 * @returns The launched server handle (Next form, port 43217) and the requests `fetch` received.
 */
async function launcherWithFetch(
  answer: (url: string) => StandInResponse,
): Promise<{
  server: ReturnType<typeof ServerModule.launchDevelopmentServer>
  requests: RecordedRequest[]
}> {
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'),
    nativeRequire = createRequire(filename)
  const exports: Partial<typeof ServerModule> = {},
    requests: RecordedRequest[] = []
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
      URL,
      process: { env: {} },
      fetch: async (url: string, init: { redirect?: string }) => {
        requests.push({ url, redirect: init.redirect })
        const { status, location } = answer(url)
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(location ? { location } : {}),
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
  return { server, requests }
}

/**
 * Reads the message of an error thrown in the launcher's own realm, where `instanceof Error` does not hold.
 * @param failure - What the readiness check rejected with.
 * @returns The message, or `undefined` for a value with none.
 */
function messageOf(failure: unknown): unknown {
  return typeof failure === 'object' && failure !== null
    ? Reflect.get(failure, 'message')
    : undefined
}

// Value: protects=an App run whose entry is "/" keeps following the root's redirects and needs the final page to answer ok (today's ready()); fails_when=the root check stops following redirects or adds a request; why_new=Cycle 0065 pt1 App characterization (the Pages structured check adds redirect: manual beside it); seam=isolated launcher context with a stand-in fetch; no_claim=the real HTTP redirect following of undici
test('an App root entry follows its redirects and is ready when the final page answers ok', async () => {
  // Arrange
  const { server, requests } = await launcherWithFetch(() => ({ status: 200 }))
  // Act
  const origin = await server.ready(new AbortController().signal, '/')
  // Assert
  assert.equal(origin, 'http://127.0.0.1:43217')
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217', redirect: undefined },
  ])
})

// Value: protects=an App run whose non-root entry answers 404 keeps today's uncoded sentence word for word; fails_when=the text, the status or the advice changes, or the check follows the redirect; why_new=Cycle 0065 pt1 App characterization; seam=isolated launcher context with a stand-in fetch; no_claim=the service's wording of an uncoded failure
test('a non-root App entry that answers 404 fails with the uncoded sentence naming the status', async () => {
  // Arrange
  const { server, requests } = await launcherWithFetch(() => ({ status: 404 }))
  // Act
  const failure = await server
    .ready(new AbortController().signal, '/dashboard')
    .catch((error: unknown) => error)
  // Assert
  assert.equal(
    messageOf(failure),
    'Selected application page failed or redirected: 404. Select the actual entry path and prerequisites.',
  )
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217/dashboard', redirect: 'manual' },
  ])
})

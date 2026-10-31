import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type * as ServerModule from '../utils/launchDevelopmentServer'
import { maskNextServerOutput } from '../utils/maskNextServerOutput'

/** One request the stand-in `fetch` received: its URL and the redirect mode it was asked for. */
type RecordedRequest = { url: string; redirect?: string }

/** What the stand-in `fetch` answers for a URL: a status and, for a redirect, a `Location` header. */
type StandInResponse = { status: number; location?: string }

/**
 * Loads the real launcher in an isolated module context with a stub child that prints the listener line at once and a stand-in `fetch`, as the other launcher tests do.
 * @param answer - What the stand-in `fetch` answers for each URL.
 * @param setup - An output mask to launch with, and output the child prints before it exits instead of listening.
 * @returns The launched server handle (Next form, port 43217) and the requests `fetch` received.
 */
async function launcherWithFetch(
  answer: (url: string) => StandInResponse,
  setup: {
    outputMask?: (text: string) => string
    exitBeforeListening?: { output: string; exitCode: number }
  } = {},
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
    exitCode: null as number | null,
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
              const exit = setup.exitBeforeListening
              // A server that fails to start prints its output and exits before any listener line.
              if (exit) {
                child.stdout.emit('data', Buffer.from(exit.output))
                child.exitCode = exit.exitCode
                return read()
              }
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
    undefined,
    setup.outputMask,
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

// Value: protects=a Pages-capable run's entry check asks the entry once without following its redirect and keeps only the redacted same-origin target; fails_when=the check follows the redirect, throws for a 3xx, or keeps the token; why_new=Cycle 0065 run sequence step 3; seam=isolated launcher context with a stand-in fetch; no_claim=the refusal built from it (resolveNextPagesEntry tests)
test('a Pages-capable entry check keeps a same-origin redirect as data with its target redacted and asks nothing else', async () => {
  // Arrange
  const { server, requests } = await launcherWithFetch(() => ({
    status: 307,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
    location: '/login?token=SECRET#frag',
  }))
  // Act
  const answer = await server.readyEntry(
    new AbortController().signal,
    '/dashboard',
  )
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), {
    origin: 'http://127.0.0.1:43217',
    entry: {
      status: 307,
      location: {
        sameOrigin: true,
        // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
        path: '/login?token=<redacted>#<redacted>',
      },
    },
  })
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217/dashboard', redirect: 'manual' },
  ])
})

// Value: protects=a redirect of the entry page to another origin is never fetched or named; fails_when=a request reaches the other origin or its address is kept; why_new=Cycle 0065 (a cross-origin Location is never fetched); seam=isolated launcher context with a stand-in fetch; no_claim=none
test('a Pages-capable entry check never fetches a redirect target on another origin', async () => {
  // Arrange
  const { server, requests } = await launcherWithFetch(() => ({
    status: 302,
    location: 'https://accounts.example.com/authorize?client_secret=SECRET',
  }))
  // Act
  const answer = await server.readyEntry(new AbortController().signal, '/')
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(answer.entry)), {
    status: 302,
    location: { sameOrigin: false },
  })
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217/', redirect: 'manual' },
  ])
})

// Value: protects=an App route found through the structured check keeps today's root verdict: a redirected root is asked again following redirects and must answer ok; fails_when=the redirected root is refused, or not asked again the way ready() asks; why_new=Cycle 0065 App replay of the structured path; seam=isolated launcher context with a stand-in fetch; no_claim=a real redirect chain
test('an App root found through the structured check follows its redirect and is ready when the final page answers ok', async () => {
  // Arrange
  const { server, requests } = await launcherWithFetch((url) =>
    url === 'http://127.0.0.1:43217/'
      ? { status: 307, location: '/en' }
      : { status: 200 },
  )
  const { entry } = await server.readyEntry(new AbortController().signal, '/')
  // Act
  await server.confirmAppEntry(new AbortController().signal, '/', entry)
  // Assert
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:43217/', redirect: 'manual' },
    { url: 'http://127.0.0.1:43217', redirect: undefined },
  ])
})

// Value: protects=a Next server launched with the Pages output mask hides cookie and secret-named values in the output it quotes and journals; fails_when=a seeded SECRET reaches the exit failure; why_new=Cycle 0065 secrets requirement (server output with Set-Cookie and API_KEY); seam=isolated launcher context with a stub child; no_claim=the closed journal entry, which reads the same masked tail
test('a Next server launched with the Pages output mask quotes its exit output with cookie and secret-named values hidden', async () => {
  // Arrange
  const { server } = await launcherWithFetch(() => ({ status: 200 }), {
    outputMask: maskNextServerOutput,
    exitBeforeListening: {
      output: 'Set-Cookie: s=SECRET\nAPI_KEY=SECRET\nError: boom\n',
      exitCode: 1,
    },
  })
  // Act
  const failure = await server
    .readyEntry(new AbortController().signal, '/')
    .catch((error: unknown) => error)
  // Assert
  assert.equal(
    messageOf(failure),
    'Application exited: 1: Set-Cookie: <redacted>\nAPI_KEY=<redacted>\nError: boom\n',
  )
})

// Value: protects=an App non-root entry found through the structured check keeps today's uncoded refusal of a 404 word for word; fails_when=the text differs from ready()'s; why_new=Cycle 0065 App replay of the structured path; seam=isolated launcher context with a stand-in fetch; no_claim=none
test('an App non-root entry found through the structured check that answered 404 fails with the uncoded sentence', async () => {
  // Arrange
  const { server } = await launcherWithFetch(() => ({ status: 404 }))
  const { entry } = await server.readyEntry(
    new AbortController().signal,
    '/dashboard',
  )
  // Act
  const failure = await server
    .confirmAppEntry(new AbortController().signal, '/dashboard', entry)
    .catch((error: unknown) => error)
  // Assert
  assert.equal(
    messageOf(failure),
    'Selected application page failed or redirected: 404. Select the actual entry path and prerequisites.',
  )
})

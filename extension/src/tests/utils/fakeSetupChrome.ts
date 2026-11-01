import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import type { TestContext } from 'node:test'

import { createPipeCdpTransport } from '../../runtimeSupport/pipeCdpTransport'
import type {
  PipedBrowserProcess,
  SignInBrowserDependencies,
} from '../../runtimeSupport/signInBrowser'
import { REAL_PROCESS_STOPPER } from '../../runtimeSupport/utils/stopListedProcesses'

/** The fake Chrome: speaks NUL-framed CDP on descriptors 3 and 4 and logs every method it receives. */
const FAKE_CHROME_SOURCE = String.raw`
const fs = require('node:fs')
const [logFile, behaviour, cookiesJson] = process.argv.slice(2)
process.on('uncaughtException', (error) => {
  fs.appendFileSync(logFile, 'ERR ' + error.stack + '\n')
  process.exit(1)
})
// Sockets read the pipes without a blocking thread-pool read, so the process can exit while a read is pending.
const net = require('node:net')
const input = new net.Socket({ fd: 3, readable: true, writable: false })
const output = new net.Socket({ fd: 4, readable: false, writable: true })
const send = (message) => output.write(JSON.stringify(message) + '\0')
const answers = {
  'Browser.getVersion': () => ({ product: 'Chrome/154.0.1.2' }),
  'Storage.getCookies': () => ({ cookies: JSON.parse(cookiesJson) }),
}
let pending = ''
input.on('data', (chunk) => {
  pending += chunk.toString()
  let cut
  while ((cut = pending.indexOf('\0')) !== -1) {
    const message = JSON.parse(pending.slice(0, cut))
    pending = pending.slice(cut + 1)
    fs.appendFileSync(logFile, message.method + '\n')
    if (message.method === 'Test.closePage') {
      send({ method: 'Target.targetDestroyed', params: { targetId: 'page-1' } })
      continue
    }
    send({ id: message.id, result: (answers[message.method] ?? (() => ({})))() })
    if (message.method === 'Target.setDiscoverTargets')
      send({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'page-1', type: 'page' } } })
    if (message.method === 'Browser.close' && behaviour !== 'ignore-close') setTimeout(() => process.exit(0), 20)
  }
})
setInterval(() => {}, 1000)
`

/** A running fake setup browser and what a test reads from it. */
export type FakeSetupChrome = {
  dependencies: SignInBrowserDependencies
  /** The methods the fake received, in order. */
  methods(): Promise<string[]>
  /** Tells the fake to destroy its page target, as the learner closing the window does. */
  closePage(): void
  /** The spawned fake, for exit assertions. */
  child(): ChildProcess
  /** Makes the listing fail from now on (`true`) or work again (`false`). */
  failListing(fail: boolean): void
}

/**
 * Builds {@link SignInBrowserDependencies} whose browser is a small Node script speaking the pipe protocol, so the transport, the page tracking and the close wait run on real descriptors.
 * @param context - The test; at its end the fake is killed.
 * @param behaviour - `ignore-close` keeps the fake alive after Browser.close.
 * @param cookies - What the fake answers to Storage.getCookies.
 * @returns The dependencies and the test's views of the fake.
 */
export async function fakeSetupChrome(
  context: TestContext,
  behaviour: 'honour-close' | 'ignore-close' = 'honour-close',
  cookies: readonly object[] = [],
): Promise<FakeSetupChrome> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-fake-chrome-'))
  const script = join(folder, 'fake-chrome.js')
  const log = join(folder, 'methods.log')
  await writeFile(script, FAKE_CHROME_SOURCE)
  await writeFile(log, '')
  let child: ChildProcess | undefined
  let toBrowser: Duplex | undefined
  let isListingFailing = false
  context.after(() => {
    if (child && child.exitCode === null) child.kill('SIGKILL')
  })
  // A process that was killed but not yet reaped is a zombie: `ps` shows state Z, and the real listing no longer matches its command line.
  const isAlive = (): boolean => {
    if (!child?.pid) return false
    try {
      return !execFileSync('ps', ['-o', 'stat=', '-p', String(child.pid)], {
        encoding: 'utf8',
      })
        .trim()
        .startsWith('Z')
    } catch {
      return false
    }
  }
  return {
    dependencies: {
      spawnBrowser: (): PipedBrowserProcess => {
        const spawned = spawn(
          process.execPath,
          [script, log, behaviour, JSON.stringify(cookies)],
          {
            stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
          },
        )
        child = spawned
        let exited = false
        const listeners: (() => void)[] = []
        spawned.once('exit', () => {
          exited = true
          for (const listener of listeners.splice(0)) listener()
        })
        const [, , , to, from] = spawned.stdio
        if (!(to instanceof Duplex) || !(from instanceof Duplex))
          throw new Error('no pipes')
        toBrowser = to
        return {
          pid: spawned.pid,
          hasExited: () => exited,
          onExit: (listener): void => {
            if (exited) listener()
            else listeners.push(listener)
          },
          transport: createPipeCdpTransport(to, from),
        }
      },
      listProfileProcesses: async () => {
        if (isListingFailing) throw new Error('listing unavailable')
        return isAlive() && child?.pid
          ? [{ pid: child.pid, command: 'fake-chrome' }]
          : []
      },
      stopper: REAL_PROCESS_STOPPER,
      sleep: (ms): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, ms)),
    },
    methods: async () =>
      (await readFile(log, 'utf8')).split('\n').filter(Boolean),
    closePage: (): void => {
      toBrowser?.write('{"method":"Test.closePage"}\0')
    },
    child: () => {
      if (!child) throw new Error('not spawned')
      return child
    },
    failListing: (fail): void => {
      isListingFailing = fail
    },
  }
}

/** Waits until the child exited (used after a close the test expects to have ended it). */
export async function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'exit')
}

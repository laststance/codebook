import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import {
  probeBrowserAddress,
  type BrowserAddressProbeInput,
} from '../utils/probeBrowserAddress'
import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

import { removeTestFolder } from './utils/removeTestFolder'
import { createSelfSignedCertificate } from './utils/selfSignedCertificate'

const run = promisify(execFile)

/** The declared host the tests pin; it resolves nowhere, so only the pin can reach a server. */
const HOST = 'app.example.test'

/** Bound of one probe in these tests; far above a headless Chrome's start, below the test timeout. */
const PROBE_BOUND_MS = 20_000

/**
 * Finds the Chrome binary of the machine, or says why the test is skipped (a missing Chrome fails in CI).
 * @param context - The test.
 * @returns The binary, or `undefined` after the test was skipped.
 */
async function chromeOf(context: TestContext): Promise<string | undefined> {
  const executable = await resolveChromeExecutable(
    process.env.CODEBOOK_CHROME_EXECUTABLE ?? '',
    process.platform,
    process.env.PATH,
    (path) =>
      stat(path).then(
        (entry) => entry.isFile(),
        () => false,
      ),
  )
  const exists =
    executable !== undefined &&
    (await stat(executable).then(
      () => true,
      () => false,
    ))
  if (exists) return executable
  if (process.env.CI === 'true') throw new Error('Google Chrome is needed')
  context.skip('Google Chrome is not installed')
  return undefined
}

/** One server of a test, with the requests it saw. */
type Listening = {
  server: Server
  port: number
  requests: IncomingMessage[]
}

/**
 * Starts a loopback server and closes it when the test ends.
 * @param context - The test.
 * @param handler - Answers each request.
 * @param host - The loopback address.
 * @param make - Builds the server around the recording handler (http or https).
 * @returns The server, its port and the requests it saw.
 */
async function listen(
  context: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  host = '127.0.0.1',
  make: (
    handle: (request: IncomingMessage, response: ServerResponse) => void,
  ) => Server = createHttpServer,
): Promise<Listening> {
  const requests: IncomingMessage[] = []
  const server = make((request, response) => {
    requests.push(request)
    handler(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  context.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { server, port: (server.address() as AddressInfo).port, requests }
}

/** Answers 200 with a short body. */
const ok = (_request: IncomingMessage, response: ServerResponse): void => {
  response.end('proof')
}

/**
 * Builds the probe input for the pinned host.
 * @param chromeBinary - The binary.
 * @param port - The server's port.
 * @param overrides - Fields to change.
 * @returns The input.
 */
function inputOf(
  chromeBinary: string,
  port: number,
  overrides: Partial<BrowserAddressProbeInput> = {},
): BrowserAddressProbeInput {
  return {
    chromeBinary,
    hostResolverRules: `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    url: `http://${HOST}:${port}/proof?c=1`,
    expectedAddress: '127.0.0.1',
    expectedPort: port,
    timeoutMs: PROBE_BOUND_MS,
    ...overrides,
  }
}

/**
 * Lists the probe profile folders in the temporary folder.
 * @returns The folder names.
 */
async function probeFolders(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) =>
    name.startsWith('codebook-probe-'),
  )
}

/**
 * Lists the process command lines that name a probe profile folder.
 * @returns The command lines.
 */
async function probeProcesses(): Promise<string[]> {
  const { stdout } = await run('ps', ['-axo', 'args='], {
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
    .split('\n')
    .filter(
      (line) =>
        line.includes('--user-data-dir=') && line.includes('codebook-probe-'),
    )
}

/**
 * Writes an executable that starts the real Chrome with a forward proxy, standing for a system proxy.
 * @param context - The test, which removes the folder.
 * @param chrome - The real binary.
 * @param proxyPort - The proxy's port.
 * @returns The wrapper's path.
 */
async function proxiedChrome(
  context: TestContext,
  chrome: string,
  proxyPort: number,
): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-proxied-chrome-'))
  context.after(() => removeTestFolder(folder))
  const script = join(folder, 'chrome.sh')
  await writeFile(
    script,
    `#!/bin/sh\nexec '${chrome.replaceAll("'", "'\\''")}' --proxy-server=http://127.0.0.1:${proxyPort} "$@"\n`,
  )
  await chmod(script, 0o755)
  return script
}

// Value: protects=the saved profile is only opened after a browser was seen reaching the proved server; fails_when=the probe cannot load a pinned host name from a loopback server or reports another address or port; no_claim=a proxy-free machine only, and not that the app behind the proxy is the right one.
test('probe passes and reports the pinned address and port for a host name that resolves nowhere', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, ok)

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: true,
    address: '127.0.0.1',
    port: target.port,
    cleanupConfirmed: true,
  })
  assert.equal(target.requests[0]?.headers.host, `${HOST}:${target.port}`)
})

// Value: protects=a system proxy cannot carry the saved profile's cookies to a server that was not proved; fails_when=a browser routed through a forward proxy on another loopback port is accepted, or the pinned server saw a request; no_claim=a PAC rule that singles out the proof path.
test('probe refuses with browser-address-mismatch when a forward proxy answers instead of the pinned server', async (context) => {
  // Arrange
  if (process.platform === 'win32') return context.skip('POSIX wrapper script')
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, ok)
  const proxy = await listen(context, ok)
  const wrapper = await proxiedChrome(context, chrome, proxy.port)

  // Act
  const result = await probeBrowserAddress(
    inputOf(wrapper, target.port),
    new AbortController().signal,
  )

  // Assert
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.reason, 'browser-address-mismatch')
  // Chrome may send other background requests through the proxy; the probed one must be among them.
  assert.ok(
    proxy.requests.some((request) => request.url?.includes('/proof?c=1')),
  )
  assert.equal(target.requests.length, 0)
})

// Value: protects=the redirect of a wrong server is seen and named; fails_when=the probe fetch uses redirect manual (a network error that sends nothing) or follows a redirect into a pass; no_claim=where the redirect leads.
test('probe reports proof-redirected with the status when the server answers 302', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, (_request, response) => {
    response.writeHead(302, { location: '/elsewhere' })
    response.end()
  })

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-redirected',
    status: 302,
    cleanupConfirmed: true,
  })
  assert.ok(target.requests.length >= 1)
})

// Value: protects=another application on the port is not taken for the started server; fails_when=a 404 answer passes or loses its status; no_claim=what the other application is.
test('probe reports proof-wrong-server with the status when the server answers 404', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, (_request, response) => {
    response.writeHead(404)
    response.end()
  })

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-wrong-server',
    status: 404,
    cleanupConfirmed: true,
  })
})

// Value: protects=a server that never answers ends the check at its bound; fails_when=the probe waits past timeoutMs or reports another reason; no_claim=the length of Chrome's own start.
test('probe reports proof-timeout when the server never answers', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, () => undefined)

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port, { timeoutMs: 3_000 }),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-timeout',
    cleanupConfirmed: true,
  })
})

// Value: protects=the saved profile's cookies never ride on the check; fails_when=the probe sends a cookie or authorization header, or keeps cookies from an earlier probe; no_claim=cookies of a profile the probe never opens.
test('probe sends no cookie or authorization header even after the server set a cookie', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, (_request, response) => {
    response.setHeader('set-cookie', 'session=seeded; Path=/')
    response.end('proof')
  })

  // Act
  await probeBrowserAddress(
    inputOf(chrome, target.port),
    new AbortController().signal,
  )
  await probeBrowserAddress(
    inputOf(chrome, target.port),
    new AbortController().signal,
  )

  // Assert
  assert.equal(target.requests.length, 2)
  for (const request of target.requests) {
    assert.equal(request.headers.cookie, undefined)
    assert.equal(request.headers.authorization, undefined)
  }
})

// Value: protects=no stray Chrome or profile folder outlives a check; fails_when=a process or folder named codebook-probe remains after a pass or an abort; no_claim=Chrome helpers of other owners.
test('probe leaves no Chrome process and no profile folder after a pass and after an abort', async (context) => {
  // Arrange
  if (process.platform === 'win32') return context.skip('uses ps')
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, () => undefined)
  const foldersBefore = await probeFolders()
  const controller = new AbortController()
  const reason = new Error('stopped by the test')

  // Act
  const pending = probeBrowserAddress(
    inputOf(chrome, target.port),
    controller.signal,
  )
  setTimeout(() => controller.abort(reason), 1_500)
  const outcome = await pending.then(
    () => undefined,
    (error: unknown) => error,
  )
  const passed = await listen(context, ok)
  await probeBrowserAddress(
    inputOf(chrome, passed.port),
    new AbortController().signal,
  )

  // Assert
  assert.equal(outcome, reason)
  assert.deepEqual(await probeProcesses(), [])
  assert.deepEqual(await probeFolders(), foldersBefore)
})

// Value: protects=a certificate the browser does not trust is named before any saved cookie is sent; fails_when=an untrusted https certificate is not browser-certificate-untrusted with Chrome's error text; no_claim=other certificate errors.
test('probe reports browser-certificate-untrusted for a self-signed https server', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const { certificate, privateKey } = await createSelfSignedCertificate(HOST)
  const options = { key: privateKey, cert: certificate }
  const target = await listen(context, ok, '127.0.0.1', (handle) =>
    createHttpsServer(options, handle),
  )

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port, {
      url: `https://${HOST}:${target.port}/proof?c=1`,
    }),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'browser-certificate-untrusted',
    browserError: 'net::ERR_CERT_AUTHORITY_INVALID',
    cleanupConfirmed: true,
  })
})

// Value: protects=an IPv6 declared address is pinned with brackets and compared without them; fails_when=the rule MAP name [::1] does not load or the address keeps its brackets; no_claim=hosts without an IPv6 loopback (skipped).
test('probe passes for a host pinned to the IPv6 loopback', async (context) => {
  // Arrange
  const chrome = await chromeOf(context)
  if (chrome === undefined) return
  const target = await listen(context, ok, '::1').catch(() => undefined)
  if (target === undefined) return context.skip('no IPv6 loopback on this host')

  // Act
  const result = await probeBrowserAddress(
    inputOf(chrome, target.port, {
      hostResolverRules: `--host-resolver-rules=MAP ${HOST} [::1]`,
      expectedAddress: '::1',
    }),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: true,
    address: '::1',
    port: target.port,
    cleanupConfirmed: true,
  })
})

/**
 * Writes an executable that records its process id and then waits, standing for a Chrome that never opens its debugging port.
 * @param context - The test, which removes the folder.
 * @returns The wrapper's path and the file that receives its process id.
 */
async function stuckChrome(
  context: TestContext,
): Promise<{ script: string; pidFile: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-stuck-chrome-'))
  context.after(() => removeTestFolder(folder))
  const script = join(folder, 'chrome.sh')
  const pidFile = join(folder, 'pid')
  await writeFile(script, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 60\n`)
  await chmod(script, 0o755)
  return { script, pidFile }
}

// Value: protects=O2-2 a Stop during Chrome's start ends the check at once instead of polling for the debugging port to the bound; fails_when=an abort while Chrome is still starting waits for the 20 s bound, or leaves the process or the profile folder behind; no_claim=the length of a real Chrome's start
test('probe returns within seconds when the run is cancelled while Chrome is still starting and leaves no process or folder', async (context) => {
  // Arrange
  if (process.platform === 'win32') return context.skip('POSIX wrapper script')
  const { script, pidFile } = await stuckChrome(context)
  const foldersBefore = await probeFolders()
  const controller = new AbortController()
  const reason = new Error('stopped by the test')
  const startedAt = Date.now()

  // Act
  const pending = probeBrowserAddress(inputOf(script, 1), controller.signal)
  setTimeout(() => controller.abort(reason), 300)
  const outcome = await pending.then(
    () => undefined,
    (error: unknown) => error,
  )
  const elapsedMs = Date.now() - startedAt

  // Assert
  assert.equal(outcome, reason)
  // gstack-timing-ok: the bound is the contract; before the fix the abort waited for the probe's bound (20 s), and killing the stand-in takes milliseconds, so 3 s leaves a wide margin under load
  assert.ok(elapsedMs < 3_000, `took ${elapsedMs} ms`)
  const pid = Number((await readFile(pidFile, 'utf8')).trim())
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  assert.deepEqual(await probeFolders(), foldersBefore)
})

// Value: protects=O2-3 a binary that does not exist ends the check at once as proof-unclassified; fails_when=the probe polls for a port file to its bound or leaves the profile folder; no_claim=what the missing binary was
test('probe reports proof-unclassified well under the bound for a Chrome binary that does not exist and leaves no folder', async () => {
  // Arrange
  const foldersBefore = await probeFolders()
  const startedAt = Date.now()

  // Act
  const result = await probeBrowserAddress(
    inputOf('/nonexistent/codebook-chrome', 1),
    new AbortController().signal,
  )
  const elapsedMs = Date.now() - startedAt

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-unclassified',
    cleanupConfirmed: true,
  })
  // gstack-timing-ok: the bound is the contract; a spawn error ends the wait at once instead of polling to the probe's bound
  assert.ok(elapsedMs < 3_000, `took ${elapsedMs} ms`)
  assert.deepEqual(await probeFolders(), foldersBefore)
})

// Value: protects=O2-1 the profile folder is removed when the spawn itself throws after the folder was made; fails_when=a spawn that throws leaves a codebook-probe folder; no_claim=a failing realpath (the same record covers it)
test('probe removes its profile folder when the spawn throws', async () => {
  // Arrange
  const foldersBefore = await probeFolders()

  // Act
  const result = await probeBrowserAddress(
    inputOf('chrome\0binary', 1),
    new AbortController().signal,
  )

  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-unclassified',
    cleanupConfirmed: true,
  })
  assert.deepEqual(await probeFolders(), foldersBefore)
})

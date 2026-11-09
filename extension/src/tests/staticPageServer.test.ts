import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { staticPageListenFailedRefusal } from '../staticPageRefusals'
import { awaitStaticPageReady } from '../utils/awaitStaticPageReady'
import { startStaticPageServer } from '../utils/startStaticPageServer'

import {
  createStaticPageRepository,
  STATIC_PAGE_HTML,
  STATIC_PAGE_SCRIPT,
} from './utils/staticPageFixture'

/** Reads `path` from `origin` without following redirects. */
async function get(origin: string, path: string) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    cache: response.headers.get('cache-control'),
    text: await response.text(),
  }
}

// Value: protects=AC 2 the server listens on a loopback port the operating system picked and serves index.html for / and the folder's files with their content types and no-store; fails_when=another host or a fixed port is used, / is not index.html, or a type or cache header is wrong; no_claim=that a browser renders the page
test('the static server listens on a loopback port and serves index.html for / and the scripts with their types', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  // Act
  const root = await get(server.origin, '/')
  const script = await get(server.origin, '/main.js')
  // Assert
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.ok(server.port > 0)
  assert.deepEqual(root, {
    status: 200,
    type: 'text/html; charset=utf-8',
    cache: 'no-store',
    text: STATIC_PAGE_HTML,
  })
  assert.deepEqual(script, {
    status: 200,
    type: 'text/javascript; charset=utf-8',
    cache: 'no-store',
    text: STATIC_PAGE_SCRIPT,
  })
})

// Value: protects=AC 2 a path that leaves the folder (dot segments, encoded dots, a link out) answers 403 and a missing file 404, so no file outside the page folder is served; fails_when=a file outside the folder is answered; no_claim=other transports than HTTP on the loopback port
test('the static server answers 403 for a path or link leaving the folder and 404 for a missing file', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    '../outside.txt': 'secret',
  })
  await symlink(
    join(repository.pageFolder, '..', 'outside.txt'),
    join(repository.pageFolder, 'linked.txt'),
  )
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  // Act
  const encoded = await get(server.origin, '/..%2foutside.txt')
  const link = await get(server.origin, '/linked.txt')
  const missing = await get(server.origin, '/nothing.js')
  // Assert
  assert.equal(encoded.status, 403)
  assert.equal(link.status, 403)
  assert.equal(missing.status, 404)
  assert.ok(![encoded.text, link.text].includes('secret'))
})

// Value: protects=AC 2 the server closes with the run: after close nothing listens and a second close is harmless; fails_when=the port stays open after close or a second close throws; no_claim=a process group (the server is no child process)
test('closing the static server frees its port and closing again is harmless', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const server = await startStaticPageServer(repository.pageFolder)
  // Act
  await server.close()
  await server.close()
  const reached = await fetch(`${server.origin}/`).then(
    () => true,
    () => false,
  )
  // Assert
  assert.equal(server.isRunning(), false)
  assert.equal(reached, false)
})

// Value: protects=AC 2 a folder that cannot be served is refused by name before a port opens; fails_when=a missing folder starts a server or fails with an unnamed error; no_claim=other listen failures (none can be provoked on a free loopback port)
test('the static server refuses a page folder that does not exist', async () => {
  // Arrange
  const missing = join(
    await mkdtemp(join(tmpdir(), 'codebook-page-absent-')),
    'absent',
  )
  // Act
  const outcome = await startStaticPageServer(missing).then(
    () => 'started',
    (error: unknown) =>
      error instanceof StudyError
        ? `${error.code}/${String(error.details?.reason)}`
        : 'other',
  )
  // Assert
  assert.equal(outcome, 'STATIC_PAGE_SERVER_FAILED/listen-failed')
})

// Value: protects=AC 1 readiness is the entry page answering HTML and every same-origin script answering JavaScript, and it waits for a script that appears later; fails_when=the wait returns before the script is served, or never returns after it is; no_claim=cross-origin scripts (the page's own business)
test('the readiness wait ends once the entry page and its same-origin scripts are served', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'index.html':
      '<!doctype html><script src="late.js"></script><script src="https://unpkg.com/x@1/a.js"></script>',
  })
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  const signal = new AbortController().signal
  const settled = awaitStaticPageReady(`${server.origin}/`, 5_000, signal).then(
    () => 'ready',
  )
  // Act
  await new Promise((resolve) => setTimeout(resolve, 250))
  await mkdir(repository.pageFolder, { recursive: true })
  await writeFile(join(repository.pageFolder, 'late.js'), 'window.late = 1\n')
  const outcome = await settled
  // Assert
  assert.equal(outcome, 'ready')
})

// Value: protects=AC 2 the listen failure has its own coded refusal carrying its reason and no side effects; fails_when=the refusal loses its code, reason or sideEffects; no_claim=the operating system's own errors
test('a listen failure is the STATIC_PAGE_SERVER_FAILED refusal with reason listen-failed', () => {
  // Arrange
  // Act
  const refusal = staticPageListenFailedRefusal('EACCES')
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'STATIC_PAGE_SERVER_FAILED')
  assert.deepEqual(refusal.details, {
    reason: 'listen-failed',
    cause: 'EACCES',
    sideEffects: 'none',
  })
  assert.match(
    refusal.recoveryOverride ?? '',
    /codebook:\/\/help\/repository-browser#STATIC_PAGE_SERVER_FAILED/,
  )
})

/** Reads `path` from the loopback server with an explicit `Host` header, which `fetch` cannot set. */
function getWithHost(
  port: number,
  path: string,
  host: string,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, headers: { Host: host } },
      (response) => {
        response.resume()
        resolve(response.statusCode)
      },
    )
    request.on('error', reject)
    request.end()
  })
}

// Value: protects=D-f a page opened under another host name (DNS rebinding) cannot read the folder; fails_when=a request whose Host header is not 127.0.0.1:<port> or localhost:<port> is answered 200; no_claim=that a browser ever sends such a request
test('the static server answers 403 to a request whose Host header is not the loopback server', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  // Act
  const statuses = [
    await getWithHost(server.port, '/', 'attacker.example.test'),
    await getWithHost(server.port, '/', `attacker.example.test:${server.port}`),
    await getWithHost(server.port, '/', `127.0.0.1:${server.port}`),
    await getWithHost(server.port, '/', `localhost:${server.port}`),
  ]
  // Assert
  assert.deepEqual(statuses, [403, 403, 200, 200])
})

// Value: protects=D-f dotfiles and dot-folders (.env, .git) of the page folder are never served; fails_when=a path with a segment starting with a dot is answered 200; no_claim=files the folder keeps under other names
test('the static server answers 403 for a dotfile and a file in a dot-folder', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    '.env': 'SECRET=1',
    '.git/config': '[core]',
  })
  const server = await startStaticPageServer(repository.pageFolder)
  context.after(() => server.close())
  // Act
  const env = await get(server.origin, '/.env')
  const git = await get(server.origin, '/.git/config')
  const page = await get(server.origin, '/main.js')
  // Assert
  assert.deepEqual([env.status, git.status, page.status], [403, 403, 200])
})

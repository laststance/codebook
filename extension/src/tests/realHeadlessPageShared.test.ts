import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  closeRealHeadlessChrome,
  launchRealHeadlessPage,
  type RealHeadlessPage,
} from './utils/realHeadlessPage'

/** The private temporary folder the first test points `TMPDIR` at; the file's Chrome keeps its profile there until the file ends. */
let privateFolder: string | undefined

// One headless Chrome serves the whole file: it ends with the file, then the private folder that held its profile goes.
after(async () => {
  await closeRealHeadlessChrome()
  if (privateFolder) await rm(privateFolder, { recursive: true, force: true })
})

/** How long a page may take to show the local page it was sent to. */
const PAGE_NAVIGATION_BOUND_MS = 10_000

/**
 * Points this process's temporary folder at a private one for the test, so the Chrome profile folders the helper makes there are this test's alone, not those of a test file running beside it; `TMPDIR` is restored when the test ends, and the file's `after` hook removes the folder once its Chrome has ended.
 * @param context - The test, whose `after` hook restores `TMPDIR`.
 * @returns The private folder.
 * @example const folder = await privateTemporaryFolder(context)
 */
async function privateTemporaryFolder(context: TestContext): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-headless-shared-'))
  const previous = process.env.TMPDIR
  process.env.TMPDIR = folder
  privateFolder = folder
  context.after(() => {
    // The file's Chrome keeps its profile in this folder until the file ends, so only the variable is restored here.
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
  })
  return folder
}

/**
 * Starts a local HTTP server that answers every request with one small HTML page, so two pages can share one real origin (a `data:` URL is an opaque origin with no usable `localStorage`); closed when the test ends.
 * @param context - The test, whose `after` hook closes the server.
 * @returns The page's URL.
 * @example const url = await servePage(context) // => 'http://127.0.0.1:51234/'
 */
async function servePage(context: TestContext): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>shared origin</title><p>page</p>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}/`
}

/**
 * Sends a page to a URL and waits until that document has loaded.
 * @param page - The page.
 * @param url - Where it goes.
 * @example await visit(page, 'http://127.0.0.1:51234/')
 */
async function visit(page: RealHeadlessPage, url: string): Promise<void> {
  await page.evaluate(`location.href = ${JSON.stringify(url)}`)
  await waitUntil(
    async () =>
      (await page
        .evaluate(
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
        )
        .catch(() => false)) === true,
    'the page at the local URL',
    PAGE_NAVIGATION_BOUND_MS,
  )
}

// Value: protects=the real-Chrome gate tests of one file run in one Chrome: two pages asked for in one test process start one Chrome (one profile folder), so a slow start under a loaded CI runner has 1 chance per file instead of 1 per test; fails_when=each page starts its own Chrome (2 profile folders), as the helper did before Cycle 0112 when CI's coverage run failed with "Chrome published no debugging endpoint within 30 s."; why_new=Cycle 0112 (Issue 288, carried from Cycle 0111); seam=TMPDIR pointed at a private folder so only this test's profile folders are counted; no_claim=how long a start takes on CI, and a Chrome that exits between tests (the helper starts a new one; not exercised here)
test('two real headless pages of one test file are served by one Chrome', async (context) => {
  // Arrange
  const folder = await privateTemporaryFolder(context)

  // Act
  const first = await launchRealHeadlessPage(context)
  if (!first) return
  const second = await launchRealHeadlessPage(context)

  // Assert
  assert.ok(second)
  const profiles = (await readdir(folder)).filter((name) =>
    name.startsWith('codebook-gate-chrome-'),
  )
  assert.equal(profiles.length, 1)
})

// Value: protects=pages of the shared Chrome stay apart as separate profiles kept them: a value one page stores in localStorage for an origin is not visible to the next page on that origin; fails_when=the helper hands every page the same browser context, so the second page reads the first page's value; why_new=Cycle 0112 (one Chrome per file); seam=a local HTTP server giving both pages one real origin; no_claim=cookies, frames and other storage kinds (one browser context separates them all; only localStorage is read here)
test('two real headless pages of one test file do not share storage', async (context) => {
  // Arrange
  const url = await servePage(context)
  const first = await launchRealHeadlessPage(context)
  if (!first) return
  await visit(first, url)
  await first.evaluate("localStorage.setItem('codebook-test', 'first')")
  assert.equal(
    await first.evaluate("localStorage.getItem('codebook-test')"),
    'first',
  )

  // Act
  const second = await launchRealHeadlessPage(context)
  assert.ok(second)
  await visit(second, url)
  const seen = await second.evaluate("localStorage.getItem('codebook-test')")

  // Assert
  assert.equal(seen, null)
})

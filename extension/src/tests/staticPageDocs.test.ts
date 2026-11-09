import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * Reads a file the extension package ships; tests run from `dist/tests`.
 * @param segments - The path below the package root.
 * @returns The file's text.
 * @example await readPackaged('README.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// Value: protects=the README tells a learner the static-page adapter serves a plain HTML page as written, lists a page that needs a bundler as not ready with needs-bundler, and names every refusal code with its reasons; fails_when=a refusal code or reason, the adapter name or the needs-bundler gap is dropped from the README; no_claim=that the adapter implements these refusals
test('the README describes the static-page adapter, the needs-bundler gap and its refusals', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const missing = [
    '**Plain HTML pages (MCP API 1.42).**',
    'runs with the `static-page` adapter',
    'serves the page as written from its own loopback static server, with no build step',
    "the browser stops in the page's inline scripts and same-origin `.js` files",
    'is listed not ready with the gap `needs-bundler`',
    "imports a bare specifier such as `import 'lib'`",
    '`examples/page`',
    '`STATIC_PAGE_UNSUPPORTED` (reasons `no-entry-page`, `needs-bundler`, `entry-unreadable` and `not-a-static-page`)',
    '`STATIC_PAGE_SERVER_FAILED` (reason `listen-failed`',
    '`STATIC_PAGE_SEAL_FAILED` (reasons `outside-package`, `node-modules`, `not-in-page-script`, `ambiguous-source` and `map-unreadable`',
    'The `staticPageQuickStart` section of the repository-browser help',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
})

// Value: protects=the README tells a learner that library redirects the page's CDN import to the checked-out library, that an absent path ends the run with library-path-absent, and that without library the page loads the published copy and the run says so; fails_when=the redirect, the refusal or the published-copy sentence is removed; no_claim=that the redirect works for a given CDN URL
test('the README explains the CDN redirect with library, library-path-absent and the published copy without it', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const missing = [
    'declares `library` (the pack route), Codebook builds and packs the checked-out library',
    "in place of the page's CDN import of that package",
    '`https://unpkg.com/<name>@<version>/<path>` and `https://cdn.jsdelivr.net/npm/<name>@<version>/<path>`',
    "with the build's source map inline",
    '`REPOSITORY_BROWSER_LIBRARY_REFUSED` and the reason `library-path-absent`',
    'Without `library`, the page loads the published copy from the CDN, and the run says so',
    'that copy is not the checked-out library',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
})

// Value: protects=the README states the API 1.42 version line, the study format 23 save and the older-Codebook listing for a static-page run; fails_when=the API line still says 1.41, or format 23 or the update sentence is missing; no_claim=that the study writer saves format 23
test('the README states MCP API 1.42 and saves a static-page run as study format 23', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const missing = [
    'with **MCP API 1.42** (`codebook_status` reports the installed build). API 1.42 is additive:',
    'A static-page run is saved as study format 23; an older Codebook lists it as saved by a newer Codebook',
    'A run of the `static-page` adapter (MCP API 1.42) is saved as format 23 (`.study.v23.json`)',
    'updates to **1.0.85**',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
  assert.equal(readme.includes('with **MCP API 1.41**'), false)
})

// Value: protects=the bundled skill 1.0.85 routes a plain HTML page to static-page only behind API 1.42, points at staticPageQuickStart, and declares library for a CDN-imported repository library; fails_when=the version, the API gate, the help pointer or the library rule is dropped; no_claim=that a chat follows the rule
test('the bundled skill routes a plain HTML page to static-page behind API 1.42 and declares library for a CDN library', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act
  const paragraph =
    skill.split('\n').find((line) => line.startsWith('**A plain HTML page')) ??
    ''
  const missing = [
    'goes to the `static-page` adapter of the `repository-browser` profile only when `codebook_status` reports API 1.42 or later (otherwise tell the learner to update Codebook)',
    'read `staticPageQuickStart` in `codebook://help/repository-browser`',
    'a page listed not ready with the gap `needs-bundler` is not a static page',
    'declare `library` so the run serves the checked-out library in place of the CDN copy',
    'without `library` the page loads the published copy, which is not the checked-out library',
  ].filter((phrase) => !paragraph.includes(phrase))
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.85"\n'))
  assert.deepEqual(missing, [])
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { staticPageHelp } from '../staticPageHelp'

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
    '`STATIC_PAGE_SERVER_FAILED` (reasons `listen-failed`',
    '`STATIC_PAGE_SEAL_FAILED` (reasons `outside-package`, `node-modules`, `not-in-page-script`, `ambiguous-source`, `unmapped-line`, `map-limit`, `map-unreadable`',
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
    'Its `details.cause` is `absent` (the packed build lacks the path), `too-large` (a file over 32 MiB) or `unreadable` (a directory or a read error).',
    'Without `library`, the page loads the published copy from the CDN (named in the served page or in one of its same-origin scripts), and the run says so',
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
    'with **MCP API 1.44** (`codebook_status` reports the installed build). API 1.44 is additive:',
    'A static-page run is saved as study format 23; an older Codebook lists it as saved by a newer Codebook',
    'A run of the `static-page` adapter (MCP API 1.42) is saved as format 23 (`.study.v23.json`)',
    'updates to **1.0.93**',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
  assert.equal(readme.includes('with **MCP API 1.41**'), false)
})

// Value: protects=the bundled skill 1.0.93 routes a plain HTML page to static-page only behind API 1.42, points at staticPageQuickStart, and declares library for a CDN-imported repository library; fails_when=the version, the API gate, the help pointer or the library rule is dropped; no_claim=that a chat follows the rule
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
  assert.match(skill, /metadata:\r?\n {2}version: "1\.0\.93"\r?\n/)
  assert.deepEqual(missing, [])
})

// Value: protects=the README's refusal sentence names every reason the help lists under each static-page refusal code, so a reason added to the code without the README fails; fails_when=a reason key of staticPageQuickStart.refusals is missing from the README paragraph; no_claim=that the adapter raises the reason
test('the README names every refusal reason the static-page help lists', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const paragraph =
    readme.split('\n').find((line) => line.startsWith('**Plain HTML pages')) ??
    ''
  const refusals = staticPageHelp().staticPageQuickStart.refusals
  // Act
  const missing = Object.entries(refusals).flatMap(([code, entry]) =>
    [code, ...Object.keys(entry.reasons)]
      .filter((name) => !paragraph.includes(`\`${name}\``))
      .map((name) => `${code}: ${name}`),
  )
  // Assert
  assert.deepEqual(missing, [])
  assert.equal(
    Object.keys(refusals.STATIC_PAGE_SEAL_FAILED?.reasons ?? {}).length,
    10,
  )
})

// Value: protects=the README names static-page as the fifth repository-browser adapter and points at the Plain HTML pages section; fails_when=the adapter count says four or static-page is missing from the adapter list; no_claim=that codebook_status lists five adapters
test('the README lists static-page among the five repository-browser adapters', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const missing = [
    'has five adapters',
    '`static-page` for a plain HTML page (see **Plain HTML pages (MCP API 1.42)** above); `codebook_status` names all five',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
  assert.equal(readme.includes('has four adapters'), false)
})

// Value: protects=README, skill and help tell a chat which page folders status lists and what a page may contain (remote references, judged links, import maps, loopback-only server without dot files, CDN import discovery); fails_when=any of these sentences is dropped from one of the three; no_claim=that the code enforces them
test('README, skill and help state page discovery and the contents rules of a static page', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const help = JSON.stringify(staticPageHelp())
  // Act
  const missingFromReadme = [
    'in `examples/*` and in `apps/*`; a `packageRoot` you declare elsewhere is judged with the same rules when the run starts',
    'A reference that starts with `//` or with a scheme (`https:`, `data:`, `blob:` and any other) is remote',
    'Only a `<link>` whose `rel` contains `stylesheet` or `modulepreload`, or `preload` with `as="script"` or `as="style"`, is judged',
    'a malformed import map is ignored',
    'malformed percent-encoding counts as a missing file',
    'answers only requests for its own loopback host (`127.0.0.1:<port>` or `localhost:<port>`) and never serves a file or folder whose name starts with `.`',
    'also behind a backslash or through a link',
    'at most 3 levels and 16 files, so a code-split chunk is covered',
  ].filter((phrase) => !readme.includes(phrase))
  const missingFromSkill = [
    'in `examples/*` and in `apps/*`, and a declared `packageRoot` elsewhere is judged when the run starts',
  ].filter((phrase) => !skill.includes(phrase))
  const missingFromHelp = [
    'examples/* and in apps/*',
    'starts with // or with a scheme',
    'rel contains stylesheet or modulepreload',
    'malformed import map is ignored',
    'answers 403 to a request whose Host is not its own',
    'also behind a backslash or through a link',
    'at most 3 levels and 16 files',
  ].filter((phrase) => !help.includes(phrase))
  // Assert
  assert.deepEqual(missingFromReadme, [])
  assert.deepEqual(missingFromSkill, [])
  assert.deepEqual(missingFromHelp, [])
})

// Value: protects=the README and the help tell that a map a packed build already carries inline is used and that a malformed one leaves the file without a map; fails_when=either sentence leaves; no_claim=which build tools inline their map
test('the README and the help state that an inline map of the packed build is used', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const help = JSON.stringify(staticPageHelp())
  const sentence =
    'a map the build already carries inline is read and renamed the same way; a malformed one leaves the file without a map'
  // Act
  const places = [readme.includes(sentence), help.includes(sentence)]
  // Assert
  assert.deepEqual(places, [true, true])
})

// Value: protects=the README tells a learner that a library stop in a minified build reads declared inspections by source name through the map names, and when it stays unavailable; fails_when=the sentence is removed; no_claim=that a given build keeps names in its map
test('the README explains that a minified library build is read by source name through the map names', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const hasSentence = readme.includes(
    "a library stop in a minified build reads each declared inspection by its source name through the build's source map names (when a name maps to one variable of the paused frame's scopes; otherwise it stays unavailable)",
  )
  // Assert
  assert.equal(hasSentence, true)
})

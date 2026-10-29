import assert from 'node:assert/strict'
import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { resolveChromeExtensionRun } from '../resolveChromeExtensionRun'
import { discoverStaticLoads } from '../utils/discoverStaticLoads'
import { findExtensionImportReferences } from '../utils/findExtensionImportReferences'
import { readExtensionManifest } from '../utils/readExtensionManifest'

import {
  BASELINE_MANIFEST,
  baselineExtensionFiles,
  createRepositoryFixture,
  parsedBaseline,
} from './utils/chromeExtensionFixture'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

/** Creates the baseline repository with changed or added files. */
async function repositoryWith(
  context: TestContext,
  changes: Record<string, string> = {},
) {
  return createRepositoryFixture(context, {
    ...baselineExtensionFiles(),
    ...changes,
  })
}

/** Runs the resolver and returns the StudyError it refuses with, failing when it resolves. */
async function refusalOf(
  repositoryRoot: string,
  overrides: Record<string, unknown> = {},
): Promise<StudyError> {
  try {
    await resolveChromeExtensionRun({
      repositoryRoot,
      configuration: parsedBaseline(overrides),
    })
  } catch (error) {
    assert.ok(error instanceof StudyError, `expected StudyError, got ${error}`)
    return error
  }
  throw new assert.AssertionError({ message: 'the run was resolved' })
}

const manifestWith = (changes: Record<string, unknown>) =>
  JSON.stringify({ ...BASELINE_MANIFEST, ...changes })

/** Reachable files of a page entry, relative to the root. */
async function reachableFrom(
  root: string,
  htmlPath: string,
  repositoryRoot?: string,
) {
  const result = await discoverStaticLoads({
    extensionRoot: root,
    ...(repositoryRoot === undefined ? {} : { repositoryRoot }),
    extensionId: EXTENSION_ID,
    entry: { kind: 'page', htmlPath: join(root, htmlPath) },
  })
  return [...result.reachable].map((file) => file.slice(root.length + 1)).sort()
}

test('a stop file that the page loads through a link inside the root is accepted', async (context) => {
  // protects=A1 realpath comparison; fails_when=a stop on the link target is refused STOP_FILE_NOT_LOADED; no_claim=case-insensitive file systems
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/real.js': 'const a = 1\nconst b = 2\n',
    'ext/popup/popup.html': '<script src="alias.js"></script>',
  })
  await symlink(
    join(repositoryRoot, 'ext/popup/real.js'),
    join(repositoryRoot, 'ext/popup/alias.js'),
  )
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      stops: [{ path: 'popup/real.js', line: 2, context: 'page' }],
    }),
  })
  // Assert
  assert.equal(
    run.stops[0]?.absolutePath,
    join(repositoryRoot, 'ext/popup/real.js'),
  )
})

test('a page script that links to a file outside the repository is not reachable', async (context) => {
  // protects=A1 reachable files stay inside the repository; fails_when=an outside file counts as loaded; no_claim=the link walk refusal
  // Arrange
  const outside = await createRepositoryFixture(context, { 'secret.js': '' })
  const root = await createRepositoryFixture(context, {
    'page.html': '<script src="leak.js"></script>',
  })
  await symlink(join(outside, 'secret.js'), join(root, 'leak.js'))
  // Act
  const reachable = await reachableFrom(root, 'page.html', root)
  // Assert
  assert.deepEqual(reachable, [])
})

test('a stop path that is a directory is refused as not a readable file', async (context) => {
  // protects=A2 no raw EISDIR; fails_when=the raw file system error escapes; no_claim=permission errors
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  await mkdir(join(repositoryRoot, 'ext/popup/folder'))
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/folder', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration.stops[0].path is not a readable file: popup/folder.',
  )
})

test('a surface page path that is a directory is refused as not a readable file', async (context) => {
  // protects=A2 surface variant; fails_when=the raw file system error escapes; no_claim=popups
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  await mkdir(join(repositoryRoot, 'ext/pages.html'))
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    surface: { kind: 'page', path: 'pages.html' },
  })
  // Assert
  assert.equal(
    refusal.message,
    'configuration.surface.path is not a readable file: pages.html.',
  )
})

test('an absolute stop path that points inside the extension root is refused as outside the root', async (context) => {
  // protects=A3 absolute paths are never extension-relative; fails_when=an absolute path inside the root passes; no_claim=outside absolute paths (covered elsewhere)
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [
      {
        path: join(repositoryRoot, 'ext/popup/popup.js'),
        line: 1,
        context: 'page',
      },
    ],
  })
  // Assert
  assert.equal(
    refusal.message,
    'configuration.stops[0].path must stay inside the extension root.',
  )
})

test('a surface page path with a space, hash and percent sign gets an encoded surface url', async (context) => {
  // protects=A4 surfaceUrl is a valid url; fails_when=the raw path is interpolated; no_claim=Chrome opens it
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/my page#1%.html': '<script src="popup/popup.js"></script>',
  })
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      surface: { kind: 'page', path: 'my page#1%.html' },
      stops: [{ path: 'popup/popup.js', line: 2, context: 'page' }],
    }),
  })
  // Assert
  assert.match(
    run.surfaceUrl,
    /^chrome-extension:\/\/[a-p]{32}\/my%20page%231%25\.html$/,
  )
})

test('an extensionRoot of dot does not walk node_modules or .git and ignores links inside them', async (context) => {
  // protects=A5 bounded walk; fails_when=a link under node_modules or .git outside the repository refuses the run; no_claim=files there are loadable
  // Arrange
  const outside = await createRepositoryFixture(context, { 'x.js': '' })
  const repositoryRoot = await createRepositoryFixture(context, {
    'manifest.json': manifestWith({ background: undefined }),
    'popup/popup.html': '<script src="popup.js"></script>',
    'popup/popup.js': 'const a = 1\nconst b = 2\n',
    'node_modules/pkg/index.js': '',
    '.git/hooks/placeholder': '',
  })
  await symlink(outside, join(repositoryRoot, 'node_modules/pkg/outside'))
  await symlink(outside, join(repositoryRoot, '.git/hooks/outside'))
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      extensionRoot: '.',
      stops: [{ path: 'popup/popup.js', line: 2, context: 'page' }],
    }),
  })
  // Assert
  assert.equal(run.stops.length, 1)
})

test('a link outside the repository outside node_modules still refuses with extensionRoot dot', async (context) => {
  // protects=A5 the skip is limited to the two folders; fails_when=every link is ignored; no_claim=nothing else
  // Arrange
  const outside = await createRepositoryFixture(context, { 'x.js': '' })
  const repositoryRoot = await repositoryWith(context)
  await symlink(outside, join(repositoryRoot, 'ext/popup/escape'))
  // Act
  const refusal = await refusalOf(repositoryRoot, { extensionRoot: '.' })
  // Assert
  assert.equal(refusal.code, 'EXTENSION_LINK_OUTSIDE')
})

test('a dangling link inside the repository does not refuse the run and one pointing outside does', async (context) => {
  // protects=A6 lexical judgement of dangling links; fails_when=every dangling link refuses or none does; no_claim=Chrome loads it
  // Arrange
  const insideRoot = await repositoryWith(context)
  await symlink('nowhere.js', join(insideRoot, 'ext/popup/dangling'))
  const outsideRoot = await repositoryWith(context)
  await symlink(
    '../../../elsewhere.js',
    join(outsideRoot, 'ext/popup/dangling'),
  )
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot: insideRoot,
    configuration: parsedBaseline(),
  })
  const refusal = await refusalOf(outsideRoot)
  // Assert
  assert.equal(run.stops.length, 2)
  assert.equal(refusal.code, 'EXTENSION_LINK_OUTSIDE')
  assert.equal(
    refusal.message,
    'The extension folder holds a link outside the repository: ext/popup/dangling.',
  )
})

test('an unlistable extension folder is refused as INVALID_CONFIGURATION instead of a raw error', async (context) => {
  // protects=A5 readdir failures are worded; fails_when=EACCES escapes; no_claim=Windows permission semantics
  // Arrange
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    context.skip('needs POSIX permissions and a non-root user')
    return
  }
  const repositoryRoot = await repositoryWith(context)
  const locked = join(repositoryRoot, 'ext/popup/locked')
  await mkdir(locked)
  await chmod(locked, 0o000)
  // Act
  // The folder is made readable again before the fixture removes the repository.
  const refusal = await refusalOf(repositoryRoot).finally(() =>
    chmod(locked, 0o700),
  )
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'The extension folder cannot be listed: ext/popup/locked.',
  )
})

test('host permissions on link-local, unspecified, IPv6 private, localhost subdomain, shared-address and wildcard-port hosts need acknowledgement', async (context) => {
  // protects=A7 private-network detection; fails_when=any of these hosts is treated as public; no_claim=DNS names resolving privately
  // Arrange
  const flagged = [
    'http://169.254.169.254/*',
    'http://0.0.0.0/*',
    'http://0.1.2.3/*',
    'http://[::1]/*',
    'http://[::1]:8080/*',
    'http://[fc00::1]/*',
    'http://[fd12:3456::1]/*',
    'http://[fe80::1]/*',
    'http://app.localhost/*',
    'http://localhost:*/*',
    'http://100.64.0.1/*',
    'http://100.127.255.1/*',
  ]
  const ordinary = [
    'http://100.63.0.1/*',
    'http://100.128.0.1/*',
    'http://169.253.0.1/*',
    'https://localhost.example.com/*',
  ]
  const messages: string[] = []
  // Act
  for (const host of flagged)
    messages.push(
      (
        await refusalOf(
          await repositoryWith(context, {
            'ext/manifest.json': manifestWith({ host_permissions: [host] }),
          }),
        )
      ).message,
    )
  const accepted = await resolveChromeExtensionRun({
    repositoryRoot: await repositoryWith(context, {
      'ext/manifest.json': manifestWith({ host_permissions: ordinary }),
    }),
    configuration: parsedBaseline(),
  })
  // Assert
  flagged.forEach((host, index) =>
    assert.ok((messages[index] ?? '').includes(`: ${host}. Pass them`), host),
  )
  assert.deepEqual(accepted.hostPermissions, ordinary)
})

test('an invalid base href is ignored and relative scripts resolve against the page', async (context) => {
  // protects=A8 no throw on an invalid base; fails_when=new URL throws out of discovery; no_claim=valid base handling
  // Arrange
  const root = await createRepositoryFixture(context, {
    'page.html': '<base href="http://[bad"><script src="a.js"></script>',
    'a.js': '',
  })
  // Act
  const reachable = await reachableFrom(root, 'page.html')
  // Assert
  assert.deepEqual(reachable, ['a.js'])
})

test('a script src inside an HTML comment is not loaded', async (context) => {
  // protects=A13 commented-out scripts are not reachable; fails_when=a commented script is followed; no_claim=conditional comments
  // Arrange
  const root = await createRepositoryFixture(context, {
    'page.html':
      '<!-- <script src="old.js"></script> --><script src="a.js"></script>',
    'a.js': '',
    'old.js': '',
  })
  // Act
  const reachable = await reachableFrom(root, 'page.html')
  // Assert
  assert.deepEqual(reachable, ['a.js'])
})

test('import text inside a string or a template literal is not followed', () => {
  // protects=A9 string and template contents are no code; fails_when=an import inside a string or template is followed; no_claim=regular expression literals
  // Arrange
  const source =
    "const s = \"import './b.js'\"\nconst t = `import './c.js'`\nconst u = 'export * from \"./d.js\"'\nimport './e.js'\n"
  // Act
  const found = findExtensionImportReferences(source, 'module')
  // Assert
  assert.deepEqual(found.references, ['./e.js'])
  assert.deepEqual(found.unfollowed, [])
})

test('imports with unicode bindings, quoted export names and very long whitespace are followed quickly', () => {
  // protects=A9 binding class covers non-ASCII and quoted names without quadratic backtracking; fails_when=such an import is missed or matching stalls; no_claim=nothing else
  // Arrange
  const source = `import { héllo, "quoted name" as q } from './b.js'\nexport { "a b" as c } from './f.js'\nimport     ${' '.repeat(50_000)}x   from './c.js'\nimport café from './d.js'\n`
  // Act
  const startedAt = performance.now()
  const found = findExtensionImportReferences(source, 'module')
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.deepEqual(found.references, ['./b.js', './c.js', './d.js', './f.js'])
  assert.ok(elapsedMs < 1000, `matching took ${elapsedMs} ms`)
})

test('a dynamic import or import.meta.url written inside a string is not reported', () => {
  // protects=A9 string contents are blanked for the unfollowed forms too; fails_when=text in a string is reported; no_claim=real dynamic imports (covered elsewhere)
  // Arrange
  const source = 'const a = \'import(x)\'\nconst b = "import.meta.url"\n'
  // Act
  const found = findExtensionImportReferences(source, 'module')
  // Assert
  assert.deepEqual(found.unfollowed, [])
})

test('importScripts keeps a literal that holds a comma and ignores comments but flags a template argument as computed', () => {
  // protects=A10 arguments are read from the blanked code; fails_when=a comma or comment turns a literal into a computed path; no_claim=nested calls
  // Arrange
  const source =
    "importScripts('a,b.js', /* note, here */ 'c.js', `d.js`)\nimportScripts('e.js' // trailing, comment\n)\n"
  // Act
  const found = findExtensionImportReferences(source, 'classic')
  // Assert
  assert.deepEqual(found.references, ['a,b.js', 'c.js', 'e.js'])
  assert.deepEqual(found.unfollowed, ['computed path'])
})

test('importScripts with only literals and a comment reports no computed path', () => {
  // protects=A10 a comment inside the arguments is no computed path; fails_when=a comment is flagged; no_claim=nothing else
  // Arrange
  const source = "importScripts('a.js', // why, because\n 'b.js')\n"
  // Act
  const found = findExtensionImportReferences(source, 'classic')
  // Assert
  assert.deepEqual(found.references, ['a.js', 'b.js'])
  assert.deepEqual(found.unfollowed, [])
})

test('a version 2 manifest without a name is refused as MANIFEST_NOT_V3, not as unreadable', async (context) => {
  // protects=A12 version is checked before name; fails_when=a nameless v2 manifest reports MANIFEST_UNREADABLE; no_claim=a v3 nameless manifest
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': JSON.stringify({ manifest_version: 2 }),
  })
  // Act
  const error = await readExtensionManifest(root).catch((reason) => reason)
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'MANIFEST_NOT_V3')
})

test('a manifest with a leading byte order mark is read', async (context) => {
  // protects=A12 BOM tolerance; fails_when=U+FEFF makes JSON.parse fail; no_claim=other encodings
  // Arrange
  const root = await createRepositoryFixture(context, {
    'manifest.json': `﻿${JSON.stringify(BASELINE_MANIFEST)}`,
  })
  // Act
  const manifest = await readExtensionManifest(root)
  // Assert
  assert.equal(manifest.name, 'Fixture Extension')
})

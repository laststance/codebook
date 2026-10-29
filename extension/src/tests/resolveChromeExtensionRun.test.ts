import assert from 'node:assert/strict'
import { access, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { resolveChromeExtensionRun } from '../resolveChromeExtensionRun'
import { chromeExtensionIdFromPath } from '../utils/chromeExtensionId'

import {
  BASELINE_MANIFEST,
  baselineExtensionFiles,
  createRepositoryFixture,
  parsedBaseline,
} from './utils/chromeExtensionFixture'

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

test('the baseline popup run resolves with the id of its real path, pinned hashes and 1-based indexes', async (context) => {
  // protects=the ResolvedExtensionRun contract, ER20 hashes, SR28 id, DXR8 indexes; fails_when=a field, hash or index changes; no_claim=Chrome loads the extension
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const root = join(repositoryRoot, 'ext')
  const extensionId = chromeExtensionIdFromPath(root)
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline(),
  })
  // Assert
  assert.equal(run.root, root)
  assert.equal(run.extensionId, extensionId)
  assert.equal(run.manifestName, 'Fixture Extension')
  assert.deepEqual(run.permissions, ['storage'])
  assert.deepEqual(run.hostPermissions, ['https://example.com/*'])
  assert.deepEqual(run.surface, { kind: 'popup', path: 'popup/popup.html' })
  assert.equal(
    run.surfaceUrl,
    `chrome-extension://${extensionId}/popup/popup.html`,
  )
  assert.equal(run.workerPath, 'background/worker.js')
  assert.deepEqual(run.clicks, [
    {
      index: 1,
      title: 'Press the button',
      selector: '#go',
      kind: 'click',
      inputs: [],
    },
  ])
  assert.deepEqual(run.stops, [
    {
      index: 1,
      path: 'popup/popup.js',
      absolutePath: join(root, 'popup/popup.js'),
      line: 2,
      context: 'page',
      sha256:
        'c8a803d31e97738f6220aecce820bfab876ec32c0f02271b6c104cb6c6f180f5',
    },
    {
      index: 2,
      path: 'background/lib.js',
      absolutePath: join(root, 'background/lib.js'),
      line: 2,
      context: 'service-worker',
      sha256:
        'e347716ef1aa564360034e705bbdf597c8af01cd12370e68554657a1209ad305',
    },
  ])
  assert.deepEqual(run.pinnedHashes, {
    [join(root, 'manifest.json')]:
      'af5926d992ce3be618e511dcc9d851d8842f09c7f6857823f8a70647df92187f',
    [join(root, 'popup/popup.html')]:
      '22fca7d119102e52b08abab5cceed7dc086c533b1166dbce8ea79043f665bb7b',
    [join(root, 'popup/popup.js')]:
      'c8a803d31e97738f6220aecce820bfab876ec32c0f02271b6c104cb6c6f180f5',
    [join(root, 'background/lib.js')]:
      'e347716ef1aa564360034e705bbdf597c8af01cd12370e68554657a1209ad305',
  })
  assert.deepEqual(run.seed, { bookmarks: [], storage: {} })
  assert.deepEqual(run.observe, { kind: 'popup' })
})

test('a page surface resolves its html under the extension root into a chrome-extension url', async (context) => {
  // protects=surface url for page runs; fails_when=the path is not joined under the id; no_claim=the page renders
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      surface: { kind: 'page', path: 'popup/popup.html' },
    }),
  })
  // Assert
  assert.deepEqual(run.surface, { kind: 'page', path: 'popup/popup.html' })
  assert.equal(
    run.surfaceUrl,
    `chrome-extension://${chromeExtensionIdFromPath(join(repositoryRoot, 'ext'))}/popup/popup.html`,
  )
})

test('a stop reached through a static import of the page script resolves', async (context) => {
  // protects=SR5 import chain; fails_when=an imported file is refused; no_claim=nothing about execution
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      stops: [{ path: 'popup/helper.js', line: 1, context: 'page' }],
    }),
  })
  // Assert
  assert.equal(run.stops[0]?.path, 'popup/helper.js')
})

test('one shared line declared in both contexts resolves as two stops', async (context) => {
  // protects=ER21 one line in both contexts; fails_when=the pair is refused as a duplicate; no_claim=runtime attribution
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.html': '<script src="shared.js"></script>',
    'ext/popup/shared.js': 'const a = 1\nconst b = 2\n',
    'ext/background/worker.js': "importScripts('../popup/shared.js')\n",
  })
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      stops: [
        { path: 'popup/shared.js', line: 2, context: 'page' },
        { path: 'popup/shared.js', line: 2, context: 'service-worker' },
      ],
    }),
  })
  // Assert
  assert.deepEqual(
    run.stops.map((stop) => stop.context),
    ['page', 'service-worker'],
  )
})

test('two stops at the same path, line and context are refused as STOP_DUPLICATE', async (context) => {
  // protects=SR5 duplicates; fails_when=both are accepted; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const stop = { path: 'popup/popup.js', line: 2, context: 'page' }
  // Act
  const refusal = await refusalOf(repositoryRoot, { stops: [stop, stop] })
  // Assert
  assert.equal(refusal.code, 'STOP_DUPLICATE')
  assert.equal(refusal.message, 'Stops 1 and 2 are the same.')
})

test('two stops that name one file through a link alias are refused as STOP_DUPLICATE with their declared indexes', async (context) => {
  // protects=SR5 duplicates by real path; fails_when=a link alias passes as a second stop; no_claim=case-insensitive file systems
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  await symlink('popup.js', join(repositoryRoot, 'ext/popup/alias.js'))
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [
      { path: 'popup/popup.js', line: 2, context: 'page' },
      { path: 'popup/alias.js', line: 2, context: 'page' },
    ],
  })
  // Assert
  assert.equal(refusal.code, 'STOP_DUPLICATE')
  assert.equal(refusal.message, 'Stops 1 and 2 are the same.')
})

test('two stops that name one file by different letter case are refused where the file system ignores case', async (context) => {
  // protects=SR5 duplicates by real path; fails_when=a case variant passes as a second stop; no_claim=case-sensitive file systems
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const isCaseInsensitive = await access(
    join(repositoryRoot, 'ext/POPUP/popup.js'),
  ).then(
    () => true,
    () => false,
  )
  if (!isCaseInsensitive) {
    context.skip('needs a case-insensitive file system')
    return
  }
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [
      { path: 'popup/popup.js', line: 2, context: 'page' },
      { path: 'POPUP/popup.js', line: 2, context: 'page' },
    ],
  })
  // Assert
  assert.equal(refusal.message, 'Stops 1 and 2 are the same.')
})

test('a stop path leaving the extension root is refused naming the field', async (context) => {
  // protects=INVALID_CONFIGURATION for paths; fails_when=a path outside is read; no_claim=the file exists
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: '../outside.js', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration.stops[0].path must stay inside the extension root.',
  )
})

test('an absolute stop path is refused as outside the extension root', async (context) => {
  // protects=absolute paths never escape; fails_when=join semantics accept /etc/hosts; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: '/etc/hosts', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(
    refusal.message,
    'configuration.stops[0].path must stay inside the extension root.',
  )
})

test('an extensionRoot outside the repository is refused naming the field', async (context) => {
  // protects=root confinement; fails_when=a sibling folder is accepted; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    extensionRoot: '../elsewhere',
  })
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration.extensionRoot must stay inside the repository.',
  )
})

test('a surface page path leaving the extension root is refused naming the field', async (context) => {
  // protects=surface path confinement; fails_when=../ is allowed; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    surface: { kind: 'page', path: '../x.html' },
  })
  // Assert
  assert.equal(
    refusal.message,
    'configuration.surface.path must stay inside the extension root.',
  )
})

test('a stop line past the end of its file is refused naming the field', async (context) => {
  // protects=no arming at a missing line; fails_when=line 99 is accepted; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/popup.js', line: 99, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration.stops[0].line is past the end of popup/popup.js.',
  )
})

test('a popup surface without action.default_popup is refused as MANIFEST_SURFACE_MISSING', async (context) => {
  // protects=MANIFEST_SURFACE_MISSING popup; fails_when=the run resolves without a popup; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ action: {} }),
  })
  // Act
  const refusal = await refusalOf(repositoryRoot)
  // Assert
  assert.equal(refusal.code, 'MANIFEST_SURFACE_MISSING')
  assert.equal(refusal.message, 'The manifest declares no popup.')
})

test('a worker stop without background.service_worker is refused as MANIFEST_SURFACE_MISSING', async (context) => {
  // protects=MANIFEST_SURFACE_MISSING worker; fails_when=the worker stop passes; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ background: undefined }),
  })
  // Act
  const refusal = await refusalOf(repositoryRoot)
  // Assert
  assert.equal(refusal.code, 'MANIFEST_SURFACE_MISSING')
  assert.equal(refusal.message, 'The manifest declares no service worker.')
})

test('a version 2 manifest is refused as MANIFEST_NOT_V3 before any stop is checked', async (context) => {
  // protects=refusal passes through from the reader; fails_when=the code changes; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ manifest_version: 2 }),
  })
  // Act
  const refusal = await refusalOf(repositoryRoot)
  // Assert
  assert.equal(refusal.code, 'MANIFEST_NOT_V3')
})

test('a page stop in a file the popup page never loads is refused as STOP_FILE_NOT_LOADED', async (context) => {
  // protects=SR5 static load rule for the page; fails_when=any file in the extension is accepted; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/stray.js': 'a\nb\n',
  })
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/stray.js', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'STOP_FILE_NOT_LOADED')
  assert.equal(refusal.message, 'Stop 1 is in a file the page does not load.')
})

test('a worker stop in a file the worker never loads is refused with the context named', async (context) => {
  // protects=SR5 static load rule for the worker; fails_when=a page file passes as a worker file; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/popup.js', line: 1, context: 'service-worker' }],
  })
  // Assert
  assert.equal(
    refusal.message,
    'Stop 1 is in a file the service worker does not load.',
  )
})

test('a stop reached only through a dynamic import is refused naming the unfollowed form and the file', async (context) => {
  // protects=SR40 sentence names the form; fails_when=the refusal is generic; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.js': "const load = () => import('./lazy.js')\n",
    'ext/popup/lazy.js': 'a\nb\n',
  })
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/lazy.js', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'STOP_FILE_NOT_LOADED')
  assert.equal(
    refusal.message,
    'Stop 1 is in a file the page does not load. Not followed: dynamic import in popup/popup.js.',
  )
})

test('a stop inside the surface html is refused as an inline script', async (context) => {
  // protects=SR5 inline scripts; fails_when=an html line is armed; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.html': '<script>\nconsole.log(1)\n</script>\n',
  })
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/popup.html', line: 2, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'STOP_FILE_NOT_LOADED')
  assert.equal(
    refusal.message,
    'Stop 1 is in an inline script; declare it in a script file.',
  )
})

test('a stop file with a sourceMappingURL comment is refused as bundled naming the rule', async (context) => {
  // protects=DXR9 source map rule; fails_when=a mapped file is accepted; no_claim=minified files without a map
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.js': 'const a = 1\n//# sourceMappingURL=popup.js.map\n',
  })
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/popup.js', line: 1, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'BUNDLED_EXTENSION_UNSUPPORTED')
  assert.equal(
    refusal.message,
    'Stop 1 is in a bundled file; this version explains unbundled extension sources only. Rule: a sourceMappingURL comment.',
  )
})

test('a stop whose own line is longer than 1000 characters is refused as bundled naming the rule', async (context) => {
  // protects=DXR9 long stop line; fails_when=the limit moves; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.js': `const a = 1\nconst b = '${'x'.repeat(1_001)}'\n`,
  })
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    stops: [{ path: 'popup/popup.js', line: 2, context: 'page' }],
  })
  // Assert
  assert.equal(refusal.code, 'BUNDLED_EXTENSION_UNSUPPORTED')
  assert.equal(
    refusal.message,
    "Stop 1 is in a bundled file; this version explains unbundled extension sources only. Rule: the stop's line is longer than 1000 characters.",
  )
})

test('a long line elsewhere in the stop file does not make it bundled', async (context) => {
  // protects=DXR9 long unrelated lines are fine; fails_when=the whole-file rule returns; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/popup/popup.js': `const a = 1\nconst long = '${'x'.repeat(5_000)}'\n`,
  })
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      stops: [{ path: 'popup/popup.js', line: 1, context: 'page' }],
    }),
  })
  // Assert
  assert.equal(run.stops[0]?.line, 1)
})

test('a link in the extension folder that leaves the repository is refused naming the link', async (context) => {
  // protects=ER6 tree walk; fails_when=the link is followed or unnamed; no_claim=links inside are refused
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const outside = await createRepositoryFixture(context, { 'secret.txt': 's' })
  await symlink(outside, join(repositoryRoot, 'ext/popup/escape'))
  // Act
  const refusal = await refusalOf(repositoryRoot)
  // Assert
  assert.equal(refusal.code, 'EXTENSION_LINK_OUTSIDE')
  assert.equal(
    refusal.message,
    'The extension folder holds a link outside the repository: ext/popup/escape.',
  )
})

test('a link that stays inside the repository does not refuse the run', async (context) => {
  // protects=ER6 only outside links refuse; fails_when=every link refuses; no_claim=the link is read
  // Arrange
  const repositoryRoot = await repositoryWith(context, { 'shared/lib.js': 'x' })
  await mkdir(join(repositoryRoot, 'ext/vendor'))
  await symlink(
    join(repositoryRoot, 'shared'),
    join(repositoryRoot, 'ext/vendor/shared'),
  )
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline(),
  })
  // Assert
  assert.equal(run.stops.length, 2)
})

test('an extensionRoot that is a link out of the repository is refused as outside the repository', async (context) => {
  // protects=SR28 realpath confinement; fails_when=the link path passes the check; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const outside = await createRepositoryFixture(
    context,
    baselineExtensionFiles(),
  )
  await symlink(join(outside, 'ext'), join(repositoryRoot, 'linked-ext'))
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    extensionRoot: 'linked-ext',
  })
  // Assert
  assert.equal(
    refusal.message,
    'configuration.extensionRoot must stay inside the repository.',
  )
})

test('an outside link is reported before a version 2 manifest', async (context) => {
  // protects=deterministic order, tree walk first; fails_when=the order changes; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ manifest_version: 2 }),
  })
  const outside = await createRepositoryFixture(context, { 'x.txt': 'x' })
  await symlink(outside, join(repositoryRoot, 'ext/escape'))
  // Act
  const refusal = await refusalOf(repositoryRoot)
  // Assert
  assert.equal(refusal.code, 'EXTENSION_LINK_OUTSIDE')
})

test('declared stops that duplicate are reported before a version 2 manifest', async (context) => {
  // protects=deterministic order, configuration checks first; fails_when=the order changes; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ manifest_version: 2 }),
  })
  const stop = { path: 'popup/popup.js', line: 1, context: 'page' }
  // Act
  const refusal = await refusalOf(repositoryRoot, { stops: [stop, stop] })
  // Assert
  assert.equal(refusal.code, 'STOP_DUPLICATE')
})

test('permissions that reach outside the test profile are refused until acknowledged exactly', async (context) => {
  // protects=ER5 refusal and exact list; fails_when=a partial or extra list passes; no_claim=the learner was told
  // Arrange
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({
      permissions: ['storage', 'debugger', 'downloads'],
      host_permissions: ['<all_urls>', 'https://example.com/*'],
    }),
  })
  const listed = ['debugger', 'downloads', '<all_urls>']
  // Act
  const refusal = await refusalOf(repositoryRoot)
  const partial = await refusalOf(repositoryRoot, {
    acknowledgedPermissions: ['debugger'],
  })
  const extra = await refusalOf(repositoryRoot, {
    acknowledgedPermissions: [...listed, 'storage'],
  })
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      acknowledgedPermissions: [...listed].reverse(),
    }),
  })
  // Assert
  const sentence =
    'The manifest declares permissions that reach outside the test profile: debugger, downloads, <all_urls>. Pass them in acknowledgedPermissions after telling the learner.'
  assert.equal(refusal.code, 'PERMISSIONS_NEED_ACKNOWLEDGEMENT')
  assert.equal(refusal.message, sentence)
  assert.equal(partial.message, sentence)
  assert.equal(extra.message, sentence)
  assert.deepEqual(run.permissions, ['storage', 'debugger', 'downloads'])
})

test('every listed API permission and every all-hosts or private-network host pattern needs acknowledgement', async (context) => {
  // protects=ER5 permission list; fails_when=an entry is missed or an ordinary host is flagged; no_claim=nothing about optional permissions
  // Arrange
  const apiPermissions = [
    'nativeMessaging',
    'debugger',
    'management',
    'downloads',
    'proxy',
    'privacy',
  ]
  const flaggedHosts = [
    '<all_urls>',
    '*://*/*',
    'http://*/*',
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1:8080/*',
    'http://10.1.2.3/*',
    'http://192.168.0.1/*',
    'http://172.16.0.1/*',
    'http://172.31.255.1/*',
    'https://printer.local/*',
  ]
  const ordinaryHosts = [
    'https://example.com/*',
    'http://172.15.0.1/*',
    'http://172.32.0.1/*',
  ]
  const withManifest = async (changes: Record<string, unknown>) =>
    refusalOf(
      await repositoryWith(context, {
        'ext/manifest.json': manifestWith(changes),
      }),
    )
  // Act
  const apiMessages: string[] = []
  for (const permission of apiPermissions)
    apiMessages.push(
      (await withManifest({ permissions: [permission] })).message,
    )
  const hostMessages: string[] = []
  for (const host of flaggedHosts)
    hostMessages.push(
      (await withManifest({ host_permissions: [host] })).message,
    )
  const ordinary = await resolveChromeExtensionRun({
    repositoryRoot: await repositoryWith(context, {
      'ext/manifest.json': manifestWith({ host_permissions: ordinaryHosts }),
    }),
    configuration: parsedBaseline(),
  })
  // Assert
  apiPermissions.forEach((permission, index) =>
    assert.match(
      apiMessages[index] ?? '',
      new RegExp(`outside the test profile: ${permission}\\.`),
    ),
  )
  flaggedHosts.forEach((host, index) =>
    assert.ok(
      (hostMessages[index] ?? '').includes(`: ${host}. Pass them`),
      host,
    ),
  )
  assert.deepEqual(ordinary.hostPermissions, ordinaryHosts)
})

test('a manifest key decides the extension id instead of the path', async (context) => {
  // protects=id key rule in the resolver; fails_when=the path rule is used for a keyed manifest; no_claim=Chrome agrees
  // Arrange
  const key =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiKYWXViZDGo+fKfo+yjXGHIWEhElf9adfvj+Slcs3aEUECCbujVVGtNthnH7j41p5W774RZLk7EcWG/Zw+t0Gg=='
  const repositoryRoot = await repositoryWith(context, {
    'ext/manifest.json': manifestWith({ key }),
  })
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline(),
  })
  // Assert
  assert.equal(run.extensionId, 'lkbpbcmlmcgphmfmhjejoinopdjlmpac')
  assert.equal(
    run.surfaceUrl,
    'chrome-extension://lkbpbcmlmcgphmfmhjejoinopdjlmpac/popup/popup.html',
  )
})

test('seed, inputs, dialog and observation pass through to the resolved run', async (context) => {
  // protects=nothing is dropped between configuration and run; fails_when=a field is lost; no_claim=the seed is written
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  const bookmarks = [
    {
      title: 'Work',
      children: [{ title: 'Docs', url: 'https://example.com/' }],
    },
  ]
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({
      clicks: [
        {
          title: 'Search',
          selector: '#go',
          kind: 'dblclick',
          dialog: 'dismiss',
          inputs: [{ selector: '#q', text: 'hi' }],
        },
      ],
      seed: { bookmarks, storage: { mode: 'popup' } },
      observe: { kind: 'storage', key: 'mode' },
    }),
  })
  // Assert
  assert.deepEqual(run.clicks, [
    {
      index: 1,
      title: 'Search',
      selector: '#go',
      kind: 'dblclick',
      dialog: 'dismiss',
      inputs: [{ selector: '#q', text: 'hi' }],
    },
  ])
  assert.deepEqual(run.seed, { bookmarks, storage: { mode: 'popup' } })
  assert.deepEqual(run.observe, { kind: 'storage', key: 'mode' })
})

test('a symlinked extension root inside the repository is resolved to its real path for the id and the root', async (context) => {
  // protects=SR28 canonical root; fails_when=the link path is passed to loadUnpacked; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  await symlink(join(repositoryRoot, 'ext'), join(repositoryRoot, 'ext-link'))
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration: parsedBaseline({ extensionRoot: 'ext-link' }),
  })
  // Assert
  assert.equal(run.root, join(repositoryRoot, 'ext'))
  assert.equal(
    run.extensionId,
    chromeExtensionIdFromPath(join(repositoryRoot, 'ext')),
  )
})

test('a missing surface page is refused naming the field', async (context) => {
  // protects=surface file must exist; fails_when=a missing page resolves; no_claim=nothing
  // Arrange
  const repositoryRoot = await repositoryWith(context)
  await writeFile(join(repositoryRoot, 'unused.txt'), 'x')
  // Act
  const refusal = await refusalOf(repositoryRoot, {
    surface: { kind: 'page', path: 'nope.html' },
  })
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration.surface.path does not exist: nope.html.',
  )
})

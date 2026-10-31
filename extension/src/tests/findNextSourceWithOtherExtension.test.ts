import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as FindNextSourceWithOtherExtensionModule from '../utils/findNextSourceWithOtherExtension'
import { findNextSourceWithOtherExtension } from '../utils/findNextSourceWithOtherExtension'

import { loadModule } from './utils/loadModule'

/** Creates an empty temporary workspace that the test removes afterwards. @example const workspace = await temporaryWorkspace(context) */
async function temporaryWorkspace(context: TestContext): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-other-extension-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}

/** Writes a tiny stand-in file (never application code) at a workspace-relative path. @example await writeStandIn(workspace, 'app/about/page.mdx') */
async function writeStandIn(workspace: string, path: string): Promise<void> {
  await mkdir(dirname(join(workspace, path)), { recursive: true })
  await writeFile(join(workspace, path), '# Stand-in\n')
}

// Value: protects=a source with the candidate's stem and another extension is found, so a custom pageExtensions source is told apart from a gone page; fails_when=the page.mdx file is not found; why_new=Cycle 0066 task 20 (gone told apart from another extension); seam=none; no_claim=which extensions Next's pageExtensions holds
test('a source with the candidate stem and another extension is found beside the missing candidate', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'app/about/page.mdx')
  await writeStandIn(workspace, 'app/about/layout.tsx')
  // Act
  const found = await findNextSourceWithOtherExtension(
    workspace,
    'app/about/page',
  )
  // Assert
  assert.equal(found, 'app/about/page.mdx')
})

// Value: protects=no file with the stem means the source is gone, also when a folder carries the stem's name; fails_when=a folder or another stem is taken as a source; why_new=Cycle 0066 task 20 (gone told apart from another extension); seam=none; no_claim=none
test('a folder with the stem name or a file of another stem is no source with another extension', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await mkdir(join(workspace, 'pages/about.mdx'), { recursive: true })
  await writeStandIn(workspace, 'pages/aboutus.tsx')
  // Act
  const found = await findNextSourceWithOtherExtension(workspace, 'pages/about')
  // Assert
  assert.equal(found, undefined)
})

// Value: protects=a style, declaration, source map, test, spec or stories file that carries a gone page's stem is no page source, so the listing is still called stale; fails_when=page.module.css, page.test.tsx or another such file counts as a custom pageExtensions source; why_new=Cycle 0066 task 37 (OCR medium: the lookup counted non-page siblings); seam=none; no_claim=a custom pageExtensions that really lists such an extension
test('only style, declaration, map, test, spec and stories files with the stem are no source with another extension', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'app/page.module.css')
  await writeStandIn(workspace, 'app/page.scss')
  await writeStandIn(workspace, 'app/page.sass')
  await writeStandIn(workspace, 'app/page.less')
  await writeStandIn(workspace, 'app/page.d.ts')
  await writeStandIn(workspace, 'app/page.d.mts')
  await writeStandIn(workspace, 'app/page.d.cts')
  await writeStandIn(workspace, 'app/page.js.map')
  await writeStandIn(workspace, 'app/page.test.tsx')
  await writeStandIn(workspace, 'app/page.spec.ts')
  await writeStandIn(workspace, 'app/page.stories.tsx')
  // Act
  const found = await findNextSourceWithOtherExtension(workspace, 'app/page')
  // Assert
  assert.equal(found, undefined)
})

// Value: protects=only the name after the stem is judged, so a page whose own name holds .test. keeps its custom pageExtensions source; fails_when=the whole file name is searched for .test. and pages/a.test.mdx reads as a test file; why_new=Cycle 0066 task 37 (non-page siblings are ignored by their name after the stem); seam=none; no_claim=none
test('a stem whose own name holds .test. still finds its source with another extension', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'pages/a.test.mdx')
  // Act
  const found = await findNextSourceWithOtherExtension(
    workspace,
    'pages/a.test',
  )
  // Assert
  assert.equal(found, 'pages/a.test.mdx')
})

// Value: protects=an untrusted stem that would leave its folder is never looked at; fails_when=a .. stem lists a folder outside the route folder; why_new=Cycle 0066 task 20 (the App key behind the stem is manifest data); seam=none; no_claim=none
test('a stem with a .. segment is never looked at, though a matching file stands where it points', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await writeStandIn(workspace, 'page.mdx')
  await mkdir(join(workspace, 'app'))
  // Act
  const found = await findNextSourceWithOtherExtension(workspace, 'app/../page')
  // Assert
  assert.equal(found, undefined)
})

// Value: protects=a folder reached through a link is never listed, so a cloned repository's link cannot make an outside file count as a source; fails_when=the linked folder is listed and its page.mdx found; why_new=Cycle 0066 task 20 (lookups never follow a link); seam=none; no_claim=Windows junctions
test('a source folder that is a link out of the workspace is not listed', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  const outside = await temporaryWorkspace(context)
  await writeStandIn(outside, 'page.mdx')
  await mkdir(join(workspace, 'app'))
  await symlink(outside, join(workspace, 'app/about'))
  // Act
  const found = await findNextSourceWithOtherExtension(
    workspace,
    'app/about/page',
  )
  // Assert
  assert.equal(found, undefined)
})

// Value: protects=a deep stem from untrusted manifest data (16,000 folder segments under an empty pages folder) is looked up in linear time, so a hostile .next/dev listing cannot stall the router contest or a Pages refusal for seconds and a gigabyte; fails_when=every prefix folder of the stem is asked at once (about 2.5 s and 0.9 GB here); why_new=Cycle 0066 task 36 (OCR medium: isUnlinkedFolder checked every stem folder at once); seam=a real temporary workspace; no_claim=the lookup's cost for a deep folder that does exist
test('a lookup of a 16,000-segment stem under an empty pages folder ends within one second', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await mkdir(join(workspace, 'pages'))
  const stem = `pages/${'a/'.repeat(16_000)}page`
  // Act
  const startedAt = performance.now()
  const found = await findNextSourceWithOtherExtension(workspace, stem)
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(found, undefined)
  // gstack-timing-ok: an explicit bound on hostile input; the walk that stops at the missing pages/a takes a few milliseconds, asking every prefix at once took about 2.5 s on the Mac, so the bound leaves a wide margin under load
  assert.ok(elapsedMs < 1_000, `the lookup took ${elapsedMs.toFixed(0)} ms`)
})

// Value: protects=the folder walk stops at the first missing component, asking nothing below it; fails_when=the folders below a missing one are asked too, so a stem's depth sets the cost; why_new=Cycle 0066 task 36 (an incremental per-component check, as isUnlinkedRegularFile does); seam=lstat recorded through the loaded module; no_claim=a component that is a file or a link (the same early return)
test('a lookup asks the status of each stem folder only up to the first missing one', async (context) => {
  // Arrange
  const workspace = await temporaryWorkspace(context)
  await mkdir(join(workspace, 'pages'))
  const asked: string[] = []
  const loaded = await loadModule<
    typeof FindNextSourceWithOtherExtensionModule
  >(resolve(__dirname, '../utils/findNextSourceWithOtherExtension.js'), {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string) => {
        asked.push(relative(workspace, path))
        return fileSystem.lstat(path)
      },
    },
  })
  // Act
  const found = await loaded.findNextSourceWithOtherExtension(
    workspace,
    'pages/a/b/c/page',
  )
  // Assert
  assert.equal(found, undefined)
  assert.deepEqual(asked, ['pages', 'pages/a'])
})

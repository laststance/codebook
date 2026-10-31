import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { findNextSourceWithOtherExtension } from '../utils/findNextSourceWithOtherExtension'

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

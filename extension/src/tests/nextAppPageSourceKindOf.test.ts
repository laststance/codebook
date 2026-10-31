import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { nextAppPageSourceKindOf } from '../utils/nextAppPageSourceKindOf'

/** Creates a temporary Next project with the given stand-in files (never application code), which the test removes afterwards. @example await projectWith(context, ['app/page.tsx']) */
async function projectWith(
  context: TestContext,
  files: readonly string[],
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-app-source-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  for (const file of files) {
    await mkdir(dirname(join(workspace, file)), { recursive: true })
    await writeFile(join(workspace, file), 'export default 1\n')
  }
  return workspace
}

// Value: protects=an App page with a default-extension source is found; fails_when=it reads as another extension or gone; why_new=Cycle 0066 task 20 (three kinds of App page source); seam=none; no_claim=none
test('an App page with a .tsx source is found', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['src/app/about/page.tsx'])
  // Act
  const kind = await nextAppPageSourceKindOf(workspace, '/about/page')
  // Assert
  assert.equal(kind, 'found')
})

// Value: protects=an App page whose only source has another extension is no stale listing; fails_when=the page.mdx source reads as gone; why_new=Cycle 0066 task 20 (Cycle 0065 fix-check 1); seam=none; no_claim=which extensions Next's pageExtensions holds
test('an App page whose only source has another extension is a custom pageExtensions source, not gone', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['app/about/page.mdx'])
  // Act
  const kind = await nextAppPageSourceKindOf(workspace, '/about/page')
  // Assert
  assert.equal(kind, 'otherExtension')
})

// Value: protects=an App page without any file of its stem is gone, a stale listing; fails_when=a neighbouring file makes it read as another extension; why_new=Cycle 0066 task 20 (gone told apart from another extension); seam=none; no_claim=none
test('an App page without any file of its stem is gone', async (context) => {
  // Arrange
  const workspace = await projectWith(context, ['app/about/layout.tsx'])
  // Act
  const kind = await nextAppPageSourceKindOf(workspace, '/about/page')
  // Assert
  assert.equal(kind, 'gone')
})

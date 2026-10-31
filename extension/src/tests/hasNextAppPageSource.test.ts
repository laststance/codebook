import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { hasNextAppPageSource } from '../utils/hasNextAppPageSource'

/** Creates a temporary workspace with an empty root `app` folder, which the test removes afterwards. @example const workspace = await workspaceWithAppFolder(context) */
async function workspaceWithAppFolder(context: TestContext): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-app-page-source-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  await mkdir(join(workspace, 'app'))
  return workspace
}

// Value: protects=an App paths manifest key, untrusted data from .next/dev, that climbs out of the App folder with a .. segment is never looked up, so a file outside the App folder never counts as the page's source; fails_when=the unsafe-key guard of hasNextAppPageSource is removed and app/../page.tsx (the workspace's page.tsx) is found; why_new=Cycle 0066 task 29; seam=a real temporary workspace; no_claim=a key with a NUL or without a leading slash
test('an App paths manifest key that climbs out of the App folder with a .. segment is not looked up, though the file it names exists', async (context) => {
  // Arrange
  const workspace = await workspaceWithAppFolder(context)
  await writeFile(
    join(workspace, 'page.tsx'),
    'export default function Page() {}\n',
  )
  // Act
  const found = await hasNextAppPageSource(workspace, '/../page')
  // Assert
  assert.equal(found, false)
})

// Value: protects=an App paths manifest key holding a backslash is never looked up, so a backslash can neither climb out of the App folder (a separator on Windows) nor name a file Next never routes (a literal name elsewhere); fails_when=the unsafe-key guard of hasNextAppPageSource is removed and the file the key reaches is found; why_new=Cycle 0066 task 29; seam=a real temporary workspace; no_claim=a key with a NUL or without a leading slash
test('an App paths manifest key with a backslash is not looked up, though a file it can reach exists', async (context) => {
  // Arrange
  const workspace = await workspaceWithAppFolder(context)
  // The files the key reaches without the guard: the workspace's page.tsx through the backslash as a separator on Windows, and the file of that literal name inside app/ elsewhere.
  await writeFile(
    join(workspace, 'page.tsx'),
    'export default function Page() {}\n',
  )
  await writeFile(
    join(workspace, 'app', '..\\page.tsx'),
    'export default function Page() {}\n',
  )
  // Act
  const found = await hasNextAppPageSource(workspace, '/..\\page')
  // Assert
  assert.equal(found, false)
})

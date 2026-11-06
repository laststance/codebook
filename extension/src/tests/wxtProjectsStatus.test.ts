import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { createEnvironmentWith } from './utils/nodeServerEnvironment'

// protects=the chrome-extension profile lists the repository's WXT projects with their resolved WXT version and the external Node (version, ready) once one is listed; fails_when=wxtProjects or wxtNode is missing, the folder or version is wrong, or Node is reported as not ready with a Node 24 present; no_claim=the real Node lookup and a real WXT install; both are fakes of the environment harness
test('codebook_status lists the WXT project and the external Node for the chrome-extension profile', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, { gaps: [] })
  const project = join(environment.workspace, 'browser-extension')
  await mkdir(join(project, 'node_modules', 'wxt'), { recursive: true })
  await writeFile(join(project, 'wxt.config.ts'), '')
  await writeFile(
    join(project, 'node_modules', 'wxt', 'package.json'),
    JSON.stringify({ version: '0.21.4' }),
  )
  // Act
  const profile = (await environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(profile?.wxtProjects)), [
    { folder: 'browser-extension', wxtVersion: '0.21.4', supported: true },
  ])
  assert.deepEqual(
    { ...profile?.wxtNode },
    { nodeVersion: '24.22.1', nodeReady: true },
  )
})

// protects=the external Node is reported only when a WXT project is listed, so a repository without WXT sees no new field about Node; fails_when=wxtNode appears for a repository without a WXT project; no_claim=that wxtProjects is empty for repositories whose config is deeper than two levels, which the discovery test covers
test('codebook_status reports no external Node for the chrome-extension profile without a WXT project', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, { gaps: [] })
  // Act
  const profile = (await environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  // Assert
  assert.equal(profile?.wxtProjects?.length, 0)
  assert.equal(profile?.wxtNode, undefined)
})

// protects=a WXT project with no usable external Node reads nodeVersion null and nodeReady false; fails_when=a missing Node reads ready; no_claim=the wording of the refusal a start gives, which the build step owns
test('codebook_status reports the external Node as not ready when none resolves for a WXT project', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, {
    gaps: [],
    nodeUnavailable: true,
  })
  await writeFile(join(environment.workspace, 'wxt.config.ts'), '')
  // Act
  const profile = (await environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  // Assert
  assert.deepEqual(
    { ...profile?.wxtNode },
    { nodeVersion: null, nodeReady: false },
  )
  assert.deepEqual(JSON.parse(JSON.stringify(profile?.wxtProjects)), [
    { folder: '.', wxtVersion: 'missing', supported: false },
  ])
})

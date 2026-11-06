import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { discoverWxtProjects } from '../utils/discoverWxtProjects'

/**
 * Makes an empty repository folder by its real path, removed when the test ends.
 * @param context - Removes the folder when the test ends.
 * @returns The repository's real root.
 */
async function repository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wxt-projects-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * Writes a file, making its folder first.
 * @param path - The absolute file path.
 * @param text - The file's text.
 */
async function put(path: string, text = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/**
 * Makes a folder a WXT project, with an installed `wxt` of the given version unless it is `undefined`.
 * @param folder - The project folder.
 * @param version - The installed WXT version, or `undefined` for none.
 * @param configName - The config file name.
 */
async function wxtProject(
  folder: string,
  version: string | undefined,
  configName = 'wxt.config.ts',
): Promise<void> {
  await put(join(folder, configName))
  if (version !== undefined)
    await put(
      join(folder, 'node_modules', 'wxt', 'package.json'),
      JSON.stringify({ name: 'wxt', version }),
    )
}

// protects=the status lists a WXT project at the root and two levels below, with its folder and resolved WXT version, and never a third level; fails_when=a project at depth 3 is listed or a depth-2 project is missed; no_claim=real WXT installs; the installed version is a stand-in package file
test('lists WXT projects at the root and up to two levels below it, with the resolved WXT version', async (context) => {
  // Arrange
  const root = await repository(context)
  await wxtProject(root, '0.21.4')
  await wxtProject(join(root, 'browser-extension'), '0.21.4', 'wxt.config.mjs')
  await wxtProject(join(root, 'apps', 'web'), '0.21.0', 'wxt.config.js')
  await wxtProject(join(root, 'a', 'b', 'c'), '0.21.4')
  // Act
  const projects = await discoverWxtProjects(root)
  // Assert
  assert.deepEqual(projects, [
    { folder: '.', wxtVersion: '0.21.4', supported: true },
    { folder: 'browser-extension', wxtVersion: '0.21.4', supported: true },
    { folder: join('apps', 'web'), wxtVersion: '0.21.0', supported: true },
  ])
})

// protects=node_modules, .git and dot-folders are never searched for a WXT config; fails_when=a config inside a dependency or a dot-folder is listed as a project; no_claim=symbolic links, which the walk does not follow
test('skips node_modules, .git and dot-folders when it looks for WXT projects', async (context) => {
  // Arrange
  const root = await repository(context)
  await wxtProject(join(root, 'node_modules', 'dependency'), '0.21.4')
  await wxtProject(join(root, '.git', 'hooks'), '0.21.4')
  await wxtProject(join(root, '.cache', 'tool'), '0.21.4')
  await wxtProject(join(root, 'real'), '0.21.4')
  // Act
  const projects = await discoverWxtProjects(root)
  // Assert
  assert.deepEqual(
    projects.map((project) => project.folder),
    ['real'],
  )
})

// protects=at most ten WXT projects are listed and the shallowest fill the list first; fails_when=an eleventh project is listed or a deep project displaces a shallow one; no_claim=ordering among folders of equal depth beyond name order
test('lists at most ten WXT projects, shallowest first', async (context) => {
  // Arrange
  const root = await repository(context)
  for (let index = 0; index < 8; index += 1)
    await wxtProject(join(root, `deep${index}`, 'inner'), '0.21.4')
  for (let index = 0; index < 5; index += 1)
    await wxtProject(join(root, `top${index}`), '0.21.4')
  // Act
  const projects = await discoverWxtProjects(root)
  // Assert
  assert.equal(projects.length, 10)
  assert.deepEqual(
    projects.slice(0, 5).map((project) => project.folder),
    ['top0', 'top1', 'top2', 'top3', 'top4'],
  )
})

// protects=a project without an installed WXT reads missing and unsupported, and other lines and prereleases read unsupported; fails_when=a missing install reads supported, or 0.22.0, 0.20.x or a prerelease reads supported; no_claim=that the version builds, which the build checks
test('reports a missing WXT and unsupported WXT versions as not buildable', async (context) => {
  // Arrange
  const root = await repository(context)
  await wxtProject(join(root, 'none'), undefined)
  await wxtProject(join(root, 'newer'), '0.22.0')
  await wxtProject(join(root, 'older'), '0.20.9')
  await wxtProject(join(root, 'pre'), '0.21.4-beta.1')
  // Act
  const projects = await discoverWxtProjects(root)
  // Assert
  assert.deepEqual(projects, [
    { folder: 'newer', wxtVersion: '0.22.0', supported: false },
    { folder: 'none', wxtVersion: 'missing', supported: false },
    { folder: 'older', wxtVersion: '0.20.9', supported: false },
    { folder: 'pre', wxtVersion: '0.21.4-beta.1', supported: false },
  ])
})

// protects=a WXT installed at the repository root counts for a project below it, as Node resolves a hoisted package; fails_when=a hoisted install reads missing; no_claim=workspaces managers' link layouts, which are not followed beyond plain node_modules folders
test('resolves a WXT hoisted to the repository root for a project below it', async (context) => {
  // Arrange
  const root = await repository(context)
  await put(join(root, 'hoisted', 'wxt.config.ts'))
  await put(
    join(root, 'node_modules', 'wxt', 'package.json'),
    JSON.stringify({ version: '0.21.2' }),
  )
  // Act
  const projects = await discoverWxtProjects(root)
  // Assert
  assert.deepEqual(projects, [
    { folder: 'hoisted', wxtVersion: '0.21.2', supported: true },
  ])
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants as fileSystemConstants, type StatOptions } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import type * as CursorSkillModule from '../cursorSkillDeployment'
import {
  deployCursorSkill,
  removeManagedCursorSkill,
  verifyManagedCursorSkill,
} from '../cursorSkillDeployment'
import {
  openWithoutFollowing,
  type NoFollowOpenConstants,
} from '../utils/openWithoutFollowing'
import { withStorageLock } from '../utils/withStorageLock'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import {
  FILE_ID_NOT_EXACT_AS_A_NUMBER,
  isFileIdExactAsANumber,
} from './utils/isFileIdExactAsANumber'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

const INITIAL_SKILL =
  '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n'
const NEXT_SKILL =
  '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.1"\n---\n\nUse current state first.\n'

/** Creates isolated package, private receipt and user-home paths for filesystem lifecycle behavior. @example await fixture(t) // { extensionPath, storageRoot, homeRoot, targetPath } */
async function fixture(context: {
  after: (callback: () => Promise<void>) => void
}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-skill-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home')
  const sourceDirectory = join(extensionPath, 'skills', 'codebook'),
    targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')
  await mkdir(sourceDirectory, { recursive: true })
  await mkdir(storageRoot)
  await mkdir(homeRoot)
  await writeFile(join(sourceDirectory, 'SKILL.md'), INITIAL_SKILL)
  return {
    extensionPath,
    storageRoot,
    homeRoot,
    targetPath,
    sourcePath: join(sourceDirectory, 'SKILL.md'),
  }
}

test('ordinary Cursor setup installs the packaged skill once and reconnect checks its exact owned bytes', async (context) => {
  // Arrange
  const paths = await fixture(context)
  // Act
  const [first, second] = await Promise.all([
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  ])
  const verified = await verifyManagedCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.deepEqual([first.status, second.status].sort(), [
    'current',
    'installed',
  ])
  assert.equal(first.version, '1.0.0')
  assert.equal(verified.status, 'current')
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL)
  assert.equal(
    first.sha256,
    createHash('sha256').update(INITIAL_SKILL).digest('hex'),
  )
})

test('Cursor setup records the active installed Wiki publisher and refreshes that path after an extension update', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const publisherMarker = '{{CODEBOOK_PUBLISHER_PATH}}'
  const skillWithPublisher =
    INITIAL_SKILL + `\nWiki publisher: \`${publisherMarker}\`\n`
  await writeFile(paths.sourcePath, skillWithPublisher)
  const firstPublisher = join(
    paths.extensionPath,
    'skills',
    'codebook',
    'publish-wiki.mjs',
  )
  await writeFile(firstPublisher, 'console.log("publisher");\n')

  // Act
  const first = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const firstBody = await readFile(paths.targetPath, 'utf8')
  const replacementExtension = join(paths.homeRoot, 'updated-extension')
  await mkdir(join(replacementExtension, 'skills', 'codebook'), {
    recursive: true,
  })
  await writeFile(
    join(replacementExtension, 'skills', 'codebook', 'SKILL.md'),
    skillWithPublisher,
  )
  const secondPublisher = join(
    replacementExtension,
    'skills',
    'codebook',
    'publish-wiki.mjs',
  )
  await writeFile(secondPublisher, 'console.log("publisher");\n')
  const updated = await deployCursorSkill(
    replacementExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  const verified = await verifyManagedCursorSkill(
    replacementExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(first.status, 'installed')
  assert.equal(firstBody.includes(firstPublisher), true)
  assert.equal(firstBody.includes(publisherMarker), false)
  assert.equal(updated.status, 'updated')
  assert.equal(verified.status, 'current')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    skillWithPublisher.replace(publisherMarker, secondPublisher),
  )
})

test('Cursor setup refuses a Wiki skill whose installed publisher is missing without creating a managed skill', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await writeFile(
    paths.sourcePath,
    `${INITIAL_SKILL}\nWiki publisher: {{CODEBOOK_PUBLISHER_PATH}}\n`,
  )

  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /missing its Wiki publisher/,
  )
  await assert.rejects(lstat(paths.targetPath), { code: 'ENOENT' })
})

test('setup refuses a pre-existing same-name Cursor skill without changing its content', async (context) => {
  // Arrange
  const paths = await fixture(context),
    custom = 'My own codebook skill'
  await mkdir(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
    recursive: true,
  })
  await writeFile(paths.targetPath, custom)
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /already exists/,
  )
  assert.equal(await readFile(paths.targetPath, 'utf8'), custom)
})

test('a later manual edit is preserved during upgrade and removal attempts', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.targetPath, 'Manually edited skill')
  await writeFile(paths.sourcePath, NEXT_SKILL)
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /edited after setup/,
  )
  await assert.rejects(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    /edited after setup/,
  )
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    'Manually edited skill',
  )
})

test('a same-byte manual replacement does not inherit the old file ownership receipt', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const replacement = join(paths.homeRoot, 'replacement.md')
  await writeFile(replacement, INITIAL_SKILL)
  await rename(replacement, paths.targetPath)
  // Act / Assert
  await assert.rejects(
    verifyManagedCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
    /missing or was changed/,
  )
  await assert.rejects(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    /replaced after setup/,
  )
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL)
})

test('an unchanged managed Cursor skill remains usable after a volume device number changes', async (context) => {
  // Arrange: macOS may assign a new device number to the same mounted volume after restart.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(
    receiptPath,
    JSON.stringify({ ...receipt, device: receipt.device + 1 }),
  )
  // Act
  const reconnected = await verifyManagedCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const updated = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const verified = await verifyManagedCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(reconnected.status, 'current')
  assert.equal(updated.status, 'updated')
  assert.equal(verified.status, 'current')
  assert.equal(await readFile(paths.targetPath, 'utf8'), NEXT_SKILL)
})

test('an owned skill updates to the new package, then explicit removal and restore preserve its receipt', async (context) => {
  // Arrange
  const paths = await fixture(context),
    original = await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  // Act
  const updated = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const removed = await removeManagedCursorSkill(
    paths.storageRoot,
    paths.homeRoot,
  )
  await assert.rejects(
    lstat(join(paths.homeRoot, '.cursor', 'skills', 'codebook')),
    { code: 'ENOENT' },
  )
  const restored = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(updated.status, 'updated')
  assert.equal(updated.version, '1.0.1')
  assert.equal(removed.status, 'removed')
  assert.equal(restored.status, 'restored')
  assert.equal(await readFile(paths.targetPath, 'utf8'), NEXT_SKILL)
  assert.equal(
    await readFile(
      join(paths.storageRoot, 'cursor-skill', `${original.sha256}.SKILL.md`),
      'utf8',
    ),
    INITIAL_SKILL,
  )
  assert.ok(
    (await readdir(join(paths.storageRoot, 'cursor-skill'))).filter((name) =>
      name.startsWith('retired-'),
    ).length >= 2,
  )
})

test('setup retries after an interrupted first installation without adopting an unowned skill', async (context) => {
  // Arrange: the previous process recorded a staged file but never published SKILL.md.
  const paths = await fixture(context),
    parent = join(paths.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await mkdir(parent, { recursive: true })
  await mkdir(join(parent, 'codebook'))
  await mkdir(receiptDirectory)
  const stagedPath = join(
    parent,
    '.codebook-stage-00000000-0000-0000-0000-000000000001.tmp',
  )
  await writeFile(stagedPath, INITIAL_SKILL)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(INITIAL_SKILL).digest('hex'),
      skillVersion: '1.0.0',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
    }),
  )
  await writeFile(join(receiptDirectory, 'writer.lock'), '{"pid":2147483647}')
  // Act: an actual process crash leaves a lock; only an operator who has confirmed its owner is gone retires it.
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /locked by another writer/,
  )
  assert.ok(await lstat(join(receiptDirectory, 'pending.json')))
  await rename(
    join(receiptDirectory, 'writer.lock'),
    join(receiptDirectory, 'writer.lock.interrupted'),
  )
  const result = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(result.status, 'installed')
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL)
  assert.equal(
    await readFile(join(receiptDirectory, 'writer.lock.interrupted'), 'utf8'),
    '{"pid":2147483647}',
  )
  await assert.rejects(lstat(stagedPath), { code: 'ENOENT' })
  await assert.rejects(lstat(join(receiptDirectory, 'pending.json')), {
    code: 'ENOENT',
  })
})

test('setup preserves an interrupted writer lock instead of racing another Cursor window to recover it', async (context) => {
  // Arrange
  const paths = await fixture(context),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await mkdir(receiptDirectory)
  await writeFile(join(receiptDirectory, 'writer.lock'), '{"pid":2147483647}')
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /locked by another writer/,
  )
  assert.equal(
    await readFile(join(receiptDirectory, 'writer.lock'), 'utf8'),
    '{"pid":2147483647}',
  )
  await assert.rejects(lstat(paths.targetPath), { code: 'ENOENT' })
})

test('setup preserves an unknown writer lock instead of assuming an interrupted owner', async (context) => {
  // Arrange
  const paths = await fixture(context),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await mkdir(receiptDirectory)
  await writeFile(join(receiptDirectory, 'writer.lock'), 'unknown owner')
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /locked by another writer/,
  )
  assert.equal(
    await readFile(join(receiptDirectory, 'writer.lock'), 'utf8'),
    'unknown owner',
  )
  await assert.rejects(lstat(paths.targetPath), { code: 'ENOENT' })
})

test('setup completes an interrupted owned upgrade only when the published inode and bytes match its recovery record', async (context) => {
  // Arrange: the new body reached Cursor, but the previous process stopped before replacing its receipt.
  const paths = await fixture(context),
    parent = join(paths.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const stagedPath = join(
    parent,
    '.codebook-stage-00000000-0000-0000-0000-000000000002.tmp',
  )
  await writeFile(stagedPath, NEXT_SKILL)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(NEXT_SKILL).digest('hex'),
      skillVersion: '1.0.1',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
    }),
  )
  await rename(stagedPath, paths.targetPath)
  // Act
  const result = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(result.status, 'current')
  assert.equal(result.version, '1.0.1')
  assert.equal(
    (
      await verifyManagedCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      )
    ).status,
    'current',
  )
  await assert.rejects(lstat(join(receiptDirectory, 'pending.json')), {
    code: 'ENOENT',
  })
})

test('interrupted setup preserves a manually edited published skill and its recovery record', async (context) => {
  // Arrange
  const paths = await fixture(context),
    parent = join(paths.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const stagedPath = join(
    parent,
    '.codebook-stage-00000000-0000-0000-0000-000000000003.tmp',
  )
  await writeFile(stagedPath, NEXT_SKILL)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(NEXT_SKILL).digest('hex'),
      skillVersion: '1.0.1',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
    }),
  )
  await rename(stagedPath, paths.targetPath)
  await writeFile(paths.targetPath, 'Learner changed the interrupted skill')
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /interrupted setup/,
  )
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    'Learner changed the interrupted skill',
  )
  assert.ok(await lstat(join(receiptDirectory, 'pending.json')))
})

test('setup restores the prior owned skill after an interrupted displacement before updating it', async (context) => {
  // Arrange: the old owned file was moved aside, but the new file was never published.
  const paths = await fixture(context),
    parent = join(paths.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const previous = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const stagedPath = join(
    parent,
    '.codebook-stage-00000000-0000-0000-0000-000000000004.tmp',
  )
  const displacedPath = join(
    parent,
    'codebook',
    '.codebook-displaced-00000000-0000-0000-0000-000000000004.tmp',
  )
  const retiredPath = join(
    receiptDirectory,
    'retired-00000000-0000-0000-0000-000000000004.SKILL.md',
  )
  await writeFile(stagedPath, NEXT_SKILL)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(NEXT_SKILL).digest('hex'),
      skillVersion: '1.0.1',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
      previous,
      displacedPath,
      retiredPath,
    }),
  )
  await rename(paths.targetPath, displacedPath)
  // Act
  const result = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(result.status, 'updated')
  assert.equal(await readFile(paths.targetPath, 'utf8'), NEXT_SKILL)
  assert.equal(await readFile(retiredPath, 'utf8'), INITIAL_SKILL)
  await assert.rejects(lstat(displacedPath), { code: 'ENOENT' })
  await assert.rejects(lstat(join(receiptDirectory, 'pending.json')), {
    code: 'ENOENT',
  })
})

test('an interrupted removal retains its adjacent fallback backup without deleting unrelated Cursor files', async (context) => {
  // Arrange
  const paths = await fixture(context),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const owner = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  const displacedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    '.codebook-displaced-00000000-0000-0000-0000-000000000005.tmp',
  )
  const retiredPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    '.codebook-retired-00000000-0000-0000-0000-000000000005.tmp',
  )
  const note = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    'learner.txt',
  )
  await writeFile(note, 'Keep this file')
  await writeFile(
    join(receiptDirectory, 'removal.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      displacedPath,
      retiredPath,
      owner,
    }),
  )
  await rename(paths.targetPath, displacedPath)
  // Act
  const removed = await removeManagedCursorSkill(
    paths.storageRoot,
    paths.homeRoot,
  )
  const restored = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(removed.status, 'removed')
  assert.equal(restored.status, 'restored')
  assert.equal(await readFile(note, 'utf8'), 'Keep this file')
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL)
  assert.equal(await readFile(retiredPath, 'utf8'), INITIAL_SKILL)
  await assert.rejects(lstat(displacedPath), { code: 'ENOENT' })
})

test('removing the managed skill leaves a user file in the same directory untouched', async (context) => {
  // Arrange
  const paths = await fixture(context),
    note = join(paths.homeRoot, '.cursor', 'skills', 'codebook', 'my-notes.txt')
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(note, 'Keep this note')
  // Act
  const removed = await removeManagedCursorSkill(
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(removed.status, 'removed')
  assert.equal(await readFile(note, 'utf8'), 'Keep this note')
  await assert.rejects(lstat(paths.targetPath), { code: 'ENOENT' })
})

test('a symlinked Cursor skill directory cannot redirect installation to unrelated work', async (context) => {
  // Arrange
  const paths = await fixture(context),
    unrelated = join(paths.homeRoot, 'unrelated')
  await mkdir(join(paths.homeRoot, '.cursor', 'skills'), { recursive: true })
  await mkdir(unrelated)
  await symlink(
    unrelated,
    join(paths.homeRoot, '.cursor', 'skills', 'codebook'),
  )
  // Act / Assert
  await assert.rejects(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    /non-directory skill path/,
  )
  assert.deepEqual(await readFile(paths.sourcePath, 'utf8'), INITIAL_SKILL)
})

const PUBLISHER_SKILL =
  '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nPublish with node {{CODEBOOK_PUBLISHER_PATH}}.\n'

/** Creates one installed extension directory with the bundled skill and its Wiki publisher, as an update leaves a new versioned directory. @example await installExtension(directory, 'laststance.codebook-0.2.27') */
async function installExtension(
  directory: string,
  name: string,
): Promise<string> {
  const extensionPath = join(directory, name),
    skillDirectory = join(extensionPath, 'skills', 'codebook')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(join(skillDirectory, 'SKILL.md'), PUBLISHER_SKILL)
  await writeFile(join(skillDirectory, 'publish-wiki.mjs'), '// publisher\n')
  return extensionPath
}

// Cycle 0044 (0041-N10-2, 0041-N10-3): red while a reconnect after an update answered "missing, changed or outdated" and left the deployed skill naming the previous installation's publisher.
test('reconnecting after an update that moved the extension directory updates Codebook’s own unedited Cursor skill to the running installation’s publisher, without another setup', async (context) => {
  // Arrange: the skill was set up from the 0.2.26 directory; the editor now runs 0.2.27 from another directory.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.26',
    ),
    runningExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    )
  await deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  // Act
  const reconnected = await verifyManagedCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  const verifiedAgain = await verifyManagedCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    `---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nPublish with node ${join(runningExtension, 'skills', 'codebook', 'publish-wiki.mjs')}.\n`,
  )
  assert.equal(reconnected.status, 'updated')
  assert.equal(verifiedAgain.status, 'current')
})

// Cycle 0044 (0041-N10-2): the automatic update never touches a skill someone edited.
test('reconnecting after an update leaves a Cursor skill that was edited since setup as it is and asks for setup', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.26',
    ),
    runningExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    )
  await deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  await writeFile(paths.targetPath, 'An edit made by the learner.\n')
  // Act
  const reconnecting = verifyManagedCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  await assert.rejects(reconnecting, /missing or was changed/)
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    'An edit made by the learner.\n',
  )
})

/** Loads the skill deployment as one more editor window would run it: its own extension version, and optionally its own storage lock or file reads, so two windows can be interleaved in one process. @example await skillWindow('0.2.29') */
async function skillWindow(
  extensionVersion: string,
  dependencies: Record<string, unknown> = {},
): Promise<typeof CursorSkillModule> {
  return loadModule<typeof CursorSkillModule>(
    resolve(__dirname, '../cursorSkillDeployment.js'),
    {
      './constants': { ...constants, EXTENSION_VERSION: extensionVersion },
      ...dependencies,
    },
    // The module tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
    { Error },
  )
}

/** The deployed skill text of one installed extension directory, as {@link installExtension} packages it. @example publisherSkillOf('/x/laststance.codebook-0.2.29') */
function publisherSkillOf(extensionPath: string): string {
  return `---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nPublish with node ${join(extensionPath, 'skills', 'codebook', 'publish-wiki.mjs')}.\n`
}

// Value: protects=the shared Cursor skill a newer window deployed; fails_when=a window still running the previous extension rewrites the skill to its older bytes and publisher path at reconnect; why_new=Cycle 0045 (RT-9); seam=the module loaded with another EXTENSION_VERSION
test('a window still running the previous extension leaves the skill a newer window deployed and reconnects', async (context) => {
  // Arrange: the 0.2.29 window deployed the skill; a window of 0.2.28 is still open and reconnects.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    ),
    newerExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.29',
    )
  const newerWindow = await skillWindow('0.2.29'),
    previousWindow = await skillWindow('0.2.28')
  await newerWindow.deployCursorSkill(
    newerExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Act
  const reconnected = await previousWindow.verifyManagedCursorSkill(
    previousExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(newerExtension),
  )
  assert.equal(reconnected.status, 'current')
  assert.equal(
    reconnected.sha256,
    createHash('sha256').update(publisherSkillOf(newerExtension)).digest('hex'),
  )
  assert.equal(
    JSON.parse(
      await readFile(
        join(paths.storageRoot, 'cursor-skill', 'receipt.json'),
        'utf8',
      ),
    ).extensionVersion,
    '0.2.29',
  )
})

// Value: protects=the shared Cursor skill naming a publisher that exists after a rollback; fails_when=a window of the previous extension accepts the skill a newer version deployed although that newer installation was removed, so every reconnect answers current and the skill keeps naming a deleted publisher until the learner runs Set Up AI Chat; why_new=Cycle 0045 local review (runtime-1 #2: a later version was accepted without a look at its installation); seam=the module loaded with another EXTENSION_VERSION, and the newer installation's directory, which the test removes
test('a window of the previous extension that reconnects after the newer installation was removed updates the skill to its own publisher', async (context) => {
  // Arrange: the 0.2.29 window deployed the skill; 0.2.29 was then uninstalled, and a window of 0.2.28 reconnects.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    ),
    newerExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.29',
    )
  const newerWindow = await skillWindow('0.2.29'),
    previousWindow = await skillWindow('0.2.28')
  await newerWindow.deployCursorSkill(
    newerExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  await rm(newerExtension, { recursive: true })

  // Act
  const reconnected = await previousWindow.verifyManagedCursorSkill(
    previousExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  const reconnectedAgain = await previousWindow.verifyManagedCursorSkill(
    previousExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(reconnected.status, 'updated')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(previousExtension),
  )
  const receipt = JSON.parse(
    await readFile(
      join(paths.storageRoot, 'cursor-skill', 'receipt.json'),
      'utf8',
    ),
  )
  assert.equal(receipt.extensionVersion, '0.2.28')
  assert.equal(
    receipt.publisherPath,
    join(previousExtension, 'skills', 'codebook', 'publish-wiki.mjs'),
  )
  assert.equal(reconnectedAgain.status, 'current')
})

// Value: protects=a newer window's skill staying untouched when its receipt cannot say where its publisher is; fails_when=a receipt without a recorded publisher path is read as a removed installation and the older window overwrites the newer skill; why_new=Cycle 0045 local review (runtime-1 #2: the path is a new, optional field of the receipt); seam=the receipt file, rewritten without the field
test('a newer window’s skill whose receipt records no publisher path is left as it is', async (context) => {
  // Arrange: the 0.2.29 window deployed the skill, and its receipt holds no publisher path, as a receipt written before the path was recorded.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    ),
    newerExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.29',
    )
  const newerWindow = await skillWindow('0.2.29'),
    previousWindow = await skillWindow('0.2.28')
  await newerWindow.deployCursorSkill(
    newerExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  const { publisherPath: _publisherPath, ...receiptWithoutPublisher } =
    JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(receiptPath, JSON.stringify(receiptWithoutPublisher))
  await rm(newerExtension, { recursive: true })

  // Act
  const reconnected = await previousWindow.verifyManagedCursorSkill(
    previousExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(reconnected.status, 'current')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(newerExtension),
  )
})

// Value: protects=the direction of the implicit update being decided under the lock; fails_when=the older window compares versions only before it takes the lock and then writes its skill over the update a newer window finished meanwhile; why_new=Cycle 0045 (RT-9, PC-4.6); seam=the older window's storage lock
test('a newer window that finishes its update between an older window’s check and its deployment keeps its skill', async (context) => {
  // Arrange: the skill is of 0.2.27; windows of 0.2.28 and of 0.2.29 both reconnect. The newer one finishes while the older one is about to take the lock.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const firstExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    ),
    olderExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    ),
    newerExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.29',
    )
  await (
    await skillWindow('0.2.27')
  ).deployCursorSkill(firstExtension, paths.storageRoot, paths.homeRoot)
  const newerWindow = await skillWindow('0.2.29')
  let hasNewerWindowUpdated = false
  let newerWindowResult: string | undefined
  const olderWindow = await skillWindow('0.2.28', {
    './utils/withStorageLock': {
      withStorageLock: async <Value>(
        lockDirectory: string,
        operation: () => Promise<Value>,
      ): Promise<Value> => {
        // The older window has looked and is about to lock; the newer window's whole update runs first, once.
        if (!hasNewerWindowUpdated) {
          hasNewerWindowUpdated = true
          const updated = await newerWindow.verifyManagedCursorSkill(
            newerExtension,
            paths.storageRoot,
            paths.homeRoot,
          )
          newerWindowResult = updated.status
        }
        return withStorageLock(lockDirectory, operation)
      },
    },
  })

  // Act
  const reconnected = await olderWindow.verifyManagedCursorSkill(
    olderExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(newerWindowResult, 'updated')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(newerExtension),
  )
  assert.equal(reconnected.status, 'current')
})

// Value: protects=every restored Cursor window reconnecting after an extension update; fails_when=a window that meets the first window's deployment reports "Learning storage is locked" and does not start its agent server; why_new=Cycle 0045 (RT-8); seam=a lock file of a running writer and the reconnecting window's storage lock
test('a window that reconnects while another window updates the shared skill waits for that update and reconnects', async (context) => {
  // Arrange: the skill is of the previous installation, and another window of the running one holds the lock for its update.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    ),
    runningExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    )
  // The previous installation's window ran 0.2.27, whatever version this build reports: a receipt of a newer version is never downgraded.
  await (
    await skillWindow('0.2.27')
  ).deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  const lockPath = join(paths.storageRoot, 'cursor-skill', 'writer.lock')
  await writeFile(
    lockPath,
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
  // The other window's lock is the file above, so its own deployment runs without taking a second one.
  const updatingWindow = await skillWindow('0.2.28', {
    './utils/withStorageLock': {
      withStorageLock: async <Value>(
        _lockDirectory: string,
        operation: () => Promise<Value>,
      ): Promise<Value> => operation(),
    },
  })
  let reportRefusal!: () => void
  const refused = new Promise<void>((resolveRefused) => {
    reportRefusal = resolveRefused
  })
  const reconnectingWindow = await skillWindow('0.2.28', {
    './utils/withStorageLock': {
      withStorageLock: async <Value>(
        lockDirectory: string,
        operation: () => Promise<Value>,
      ): Promise<Value> => {
        try {
          return await withStorageLock(lockDirectory, operation)
        } catch (error) {
          reportRefusal()
          throw error
        }
      },
    },
  })

  // Act
  const reconnecting = reconnectingWindow.verifyManagedCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  // A rejection is looked at below; until then it must not count as unhandled.
  reconnecting.catch(() => undefined)
  await refused
  await updatingWindow.deployCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )
  await unlink(lockPath)
  const reconnected = await reconnecting

  // Assert
  assert.equal(reconnected.status, 'current')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(runningExtension),
  )
})

// Value: protects=a reconnect telling another window's regular update from an edit; fails_when=the receipt is read before and the file after another window replaced both, and the reconnect answers that the skill is missing or was changed; why_new=Cycle 0045 (RT-8, PC-4.7); seam=the reconnecting window's opener, whose receipt file is read and then followed by the other window's update
test('another window’s update between a reconnect’s read of the receipt and of the skill is not answered as a missing or changed skill', async (context) => {
  // Arrange: the skill is of the previous installation; two windows of the running one reconnect.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    ),
    runningExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    )
  // The previous installation's window ran 0.2.27, whatever version this build reports: a receipt of a newer version is never downgraded.
  await (
    await skillWindow('0.2.27')
  ).deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  let hasOtherWindowUpdated = false
  let otherWindowResult: string | undefined
  const reconnectingWindow = await skillWindow('0.2.28', {
    './utils/openWithoutFollowing': {
      openWithoutFollowing: async (
        path: string,
      ): Promise<fileSystem.FileHandle> => {
        const file = await openWithoutFollowing(path)
        if (path !== receiptPath || hasOtherWindowUpdated) return file
        hasOtherWindowUpdated = true
        const readOpenedFile = file.readFile.bind(file)
        file.readFile = (async () => {
          const bytes = await readOpenedFile()
          // Right after this window read the receipt, the other window replaces the skill and writes its receipt, once.
          const updated = await verifyManagedCursorSkill(
            runningExtension,
            paths.storageRoot,
            paths.homeRoot,
          )
          otherWindowResult = updated.status
          return bytes
        }) as typeof file.readFile
        return file
      },
    },
  })

  // Act
  const reconnected = await reconnectingWindow.verifyManagedCursorSkill(
    runningExtension,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  assert.equal(otherWindowResult, 'updated')
  assert.equal(reconnected.status, 'current')
  assert.equal(
    await readFile(paths.targetPath, 'utf8'),
    publisherSkillOf(runningExtension),
  )
})

// Value: protects=the reconnect's refusal saying what happened and the next step; fails_when=the sentence still calls the skill "outdated", which a reconnect no longer refuses but updates; why_new=Cycle 0045 (SM-14); seam=none, the real files
test('a replaced or edited Cursor skill is refused at reconnect as missing or changed, and is never called outdated', async (context) => {
  // Arrange: one learner edited the deployed skill, another replaced the file with the same text.
  const edited = await fixture(context),
    replaced = await fixture(context)
  await deployCursorSkill(
    edited.extensionPath,
    edited.storageRoot,
    edited.homeRoot,
  )
  await writeFile(edited.targetPath, 'An edit made by the learner.\n')
  await deployCursorSkill(
    replaced.extensionPath,
    replaced.storageRoot,
    replaced.homeRoot,
  )
  const replacement = join(replaced.homeRoot, 'replacement.md')
  await writeFile(replacement, INITIAL_SKILL)
  await rename(replacement, replaced.targetPath)

  // Act: both reconnects settle together, so the second refusal never waits without a handler while the first is asserted.
  const reconnects = await Promise.allSettled([
    verifyManagedCursorSkill(
      edited.extensionPath,
      edited.storageRoot,
      edited.homeRoot,
    ),
    verifyManagedCursorSkill(
      replaced.extensionPath,
      replaced.storageRoot,
      replaced.homeRoot,
    ),
  ])

  // Assert
  assert.deepEqual(
    reconnects.map((reconnect) =>
      reconnect.status === 'rejected' && reconnect.reason instanceof Error
        ? reconnect.reason.message
        : reconnect.status,
    ),
    [
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ],
  )
})

// Value: protects=Cursor chat setup on an NTFS volume, where a file id passes 2^53 once its record was reused 32 times; fails_when=the skill's receipt records or validates the inode as a JavaScript number, so the next setup or reconnect ends with "Cursor skill ownership receipt is invalid; no skill file was changed." (or the receipt holds a rounded number that names no file); why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the loaded deployment and of the opener it reads through, whose files have ids above 2^53
test('the receipt of a Cursor skill whose file id is above 2^53, as on an NTFS volume, holds the id in exact decimal digits, and the next setup and reconnect find the skill current', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const largeIds = fileSystemWithLargeFileIds()
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': largeIds,
    './utils/openWithoutFollowing': await loadOpenWithoutFollowing({
      fileSystem: largeIds,
    }),
  })

  // Act
  const setup = await window.deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receipt: unknown = JSON.parse(
    await readFile(
      join(paths.storageRoot, 'cursor-skill', 'receipt.json'),
      'utf8',
    ),
  )
  const idOfTheSkill = (
    await largeIds.lstat(paths.targetPath, { bigint: true })
  ).ino
  const secondSetup = await window.deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const reconnect = await window.verifyManagedCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert: the id is one a JavaScript number rounds to 210824757556437120.
  assert.deepEqual(
    {
      setup: setup.status,
      recordedInode:
        typeof receipt === 'object' && receipt !== null && 'inode' in receipt
          ? receipt.inode
          : undefined,
      idOfTheSkillAsANumber: Number(idOfTheSkill),
      secondSetup: secondSetup.status,
      reconnect: reconnect.status,
    },
    {
      setup: 'installed',
      recordedInode: idOfTheSkill.toString(),
      idOfTheSkillAsANumber: 210_824_757_556_437_120,
      secondSetup: 'current',
      reconnect: 'current',
    },
  )
})

// Value: protects=a skill file the learner put in place of Codebook's own on an NTFS volume; fails_when=the receipted inode is compared as a JavaScript number, so a file with the same bytes whose id differs only below the rounding counts as the installed skill and the next extension update writes over it; why_new=Cycle 0046 row 79; seam=node:fs/promises of the loaded deployment and of the opener it reads through, whose files have ids above 2^53
test('a Cursor skill replaced by a file with the same bytes, whose file id differs only where a number rounds, is not counted as the installed skill: an update refuses to write over it', async (context) => {
  // Arrange: the installed skill is moved away (it stays, so its id is not given to another file) and a copy takes its path; then the extension brings a new skill.
  const paths = await fixture(context)
  const largeIds = fileSystemWithLargeFileIds()
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': largeIds,
    './utils/openWithoutFollowing': await loadOpenWithoutFollowing({
      fileSystem: largeIds,
    }),
  })
  await window.deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const movedSkillPath = join(paths.homeRoot, 'moved-SKILL.md')
  await rename(paths.targetPath, movedSkillPath)
  await writeFile(paths.targetPath, INITIAL_SKILL)
  const idOfTheInstalledSkill = (
    await largeIds.lstat(movedSkillPath, { bigint: true })
  ).ino
  const idOfTheCopy = (await largeIds.lstat(paths.targetPath, { bigint: true }))
    .ino
  await writeFile(paths.sourcePath, NEXT_SKILL)

  // Act
  const [update, reconnect] = await Promise.allSettled([
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
    window.verifyManagedCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  ])

  // Assert: two ids, one number; both entries refuse, and the copy keeps its bytes.
  assert.deepEqual(
    {
      idsDiffer: idOfTheCopy !== idOfTheInstalledSkill,
      idsAsNumbers: [Number(idOfTheInstalledSkill), Number(idOfTheCopy)],
      update:
        update.status === 'rejected' && update.reason instanceof Error
          ? update.reason.message
          : update.status,
      reconnect:
        reconnect.status === 'rejected' && reconnect.reason instanceof Error
          ? reconnect.reason.message
          : reconnect.status,
      copy: await readFile(paths.targetPath, 'utf8'),
    },
    {
      idsDiffer: true,
      idsAsNumbers: [210_824_757_556_437_120, 210_824_757_556_437_120],
      update:
        'The managed Cursor skill was replaced after setup; Codebook preserved it.',
      reconnect:
        'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
      copy: INITIAL_SKILL,
    },
  )
})

// Value: protects=a Cursor window of 0.2.29.0 that shares Codebook's storage and the skill folder with a window of this version (after an extension update, until it is reloaded, and after a rollback); fails_when=this version writes the inode of an ordinary file as text, which 0.2.29.0 rejects with "Cursor skill ownership receipt is invalid; no skill file was changed.", so that window can neither reconnect nor set up; why_new=Cycle 0046 row 79: the record keeps a number wherever a number is exact; seam=none
test('the receipt of a Cursor skill whose file id a number holds exactly records device and inode as numbers, which a window of 0.2.29.0 on the same storage still reads, and this version reads them back', async (context) => {
  // Arrange
  const paths = await fixture(context)

  // Act
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receipt: unknown = JSON.parse(
    await readFile(
      join(paths.storageRoot, 'cursor-skill', 'receipt.json'),
      'utf8',
    ),
  )
  const reconnect = await verifyManagedCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )

  // Assert
  if (!(await isFileIdExactAsANumber(paths.targetPath)))
    return context.skip(FILE_ID_NOT_EXACT_AS_A_NUMBER)
  const skill = await lstat(paths.targetPath)
  assert.deepEqual(
    {
      recorded:
        typeof receipt === 'object' &&
        receipt !== null &&
        'device' in receipt &&
        'inode' in receipt
          ? { device: receipt.device, inode: receipt.inode }
          : 'a receipt without device and inode',
      reconnect: reconnect.status,
    },
    {
      recorded: { device: skill.dev, inode: skill.ino },
      reconnect: 'current',
    },
  )
})

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = {
  O_RDONLY: fileSystemConstants.O_RDONLY,
}

/**
 * Loads the skill deployment as a window in which one path is swapped for another entry at the moment a look at the path and a read of it could come apart: right after the first look at the path (an `lstat` of the window or of its opener), or, where the open itself refuses a link and nothing looks first, right before the path is opened.
 * @param swapped - `path`: the path that is swapped, once. `swap`: puts the other entry there. `openConstants`: the open flags the window's opener gets; the system's when left out.
 * @returns The window, and the paths it read by name after the swap: a read by name follows whatever the path holds then.
 */
async function skillWindowWhosePathIsSwapped(swapped: {
  path: string
  swap: () => Promise<void>
  openConstants?: NoFollowOpenConstants
}): Promise<{
  window: typeof CursorSkillModule
  readsByNameAfterTheSwap: string[]
}> {
  let hasSwapped = false
  const readsByNameAfterTheSwap: string[] = []
  const swapOnce = async (): Promise<void> => {
    if (hasSwapped) return
    hasSwapped = true
    await swapped.swap()
  }
  const fileSystemOfTheWindow = {
    ...fileSystem,
    lstat: async (path: string, options?: StatOptions) => {
      const look = await fileSystem.lstat(path, options)
      if (path === swapped.path) await swapOnce()
      return look
    },
    readFile: async (path: string): Promise<Buffer> => {
      if (hasSwapped && path === swapped.path)
        readsByNameAfterTheSwap.push(path)
      return fileSystem.readFile(path)
    },
  }
  const opener = await loadOpenWithoutFollowing({
    openConstants: swapped.openConstants,
    fileSystem: fileSystemOfTheWindow,
  })
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': fileSystemOfTheWindow,
    './utils/openWithoutFollowing': {
      openWithoutFollowing: async (
        path: string,
      ): Promise<fileSystem.FileHandle> => {
        // Where the open itself refuses a link, no look comes before it.
        if (swapped.openConstants === undefined && path === swapped.path)
          await swapOnce()
        return opener.openWithoutFollowing(path)
      },
    },
  })
  return { window, readsByNameAfterTheSwap }
}

/**
 * Says in one text what a call of the skill deployment ended with, so a test compares one value.
 * @returns The status of the result, or the sentence of the refusal.
 */
async function statusOrRefusalOf(
  calling: Promise<CursorSkillModule.CursorSkillResult>,
): Promise<string> {
  return calling.then(
    (result) => result.status,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )
}

// Value: protects=the sentence a learner reads when a link takes the place of the managed Cursor skill while setup runs, and the file that link points to; fails_when=setup looks at the path and then reads the path by name, so the link's target is read as the skill and setup answers "The managed Cursor skill was edited after setup", which names an edit nobody made; why_new=Cycle 0046 row 142; seam=node:fs/promises lstat and the opener of the loaded deployment, at which a prepared link takes the skill's path
test('a link that takes the managed Cursor skill’s path while setup reads it is not read through: setup answers that it will not read through a link, and names what to do', async (context) => {
  // Arrange: the installed skill, a note of the learner, and a link to that note that takes the skill's path at the moment of the read. The extension brings a new skill, so setup would write.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const notePath = join(paths.homeRoot, 'a-note.md')
  const preparedLinkPath = join(paths.homeRoot, 'prepared-link')
  await writeFile(notePath, 'A note of the learner.\n')
  if (!(await createLinkIfAllowed(notePath, preparedLinkPath)))
    return context.skip(LINK_NOT_ALLOWED)
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const { window, readsByNameAfterTheSwap } =
    await skillWindowWhosePathIsSwapped({
      path: paths.targetPath,
      swap: () => rename(preparedLinkPath, paths.targetPath),
    })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      readsByNameAfterTheSwap,
      note: await readFile(notePath, 'utf8'),
      skillPathHoldsTheLink: (await lstat(paths.targetPath)).isSymbolicLink(),
    },
    {
      setup: `Codebook will not read through a link: ${paths.targetPath}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`,
      readsByNameAfterTheSwap: [],
      note: 'A note of the learner.\n',
      skillPathHoldsTheLink: true,
    },
  )
})

// Value: protects=the same in a Windows editor, where the open has no flag to refuse a link and the path is looked at first; fails_when=the file that was opened is not the file that was looked at and its bytes are still taken as the skill, or the refusal names an edit or a non-regular file instead of the replacement; why_new=Cycle 0046 row 142; seam=the open flags and node:fs/promises lstat of the opener the loaded deployment reads through, after whose look a prepared link takes the skill's path
test('a link that takes the managed Cursor skill’s path between the look at it and its open, where the system’s open cannot refuse a link, is not read through: setup answers that another file took the place of the skill', async (context) => {
  // Arrange: as above, on a system without O_NOFOLLOW.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const notePath = join(paths.homeRoot, 'a-note.md')
  const preparedLinkPath = join(paths.homeRoot, 'prepared-link')
  await writeFile(notePath, 'A note of the learner.\n')
  if (!(await createLinkIfAllowed(notePath, preparedLinkPath)))
    return context.skip(LINK_NOT_ALLOWED)
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const { window, readsByNameAfterTheSwap } =
    await skillWindowWhosePathIsSwapped({
      path: paths.targetPath,
      swap: () => rename(preparedLinkPath, paths.targetPath),
      openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      readsByNameAfterTheSwap,
      note: await readFile(notePath, 'utf8'),
      skillPathHoldsTheLink: (await lstat(paths.targetPath)).isSymbolicLink(),
    },
    {
      setup: `Another file took the place of ${paths.targetPath} while Codebook opened it, so it was not read. Run Codebook: Set Up AI Chat again.`,
      readsByNameAfterTheSwap: [],
      note: 'A note of the learner.\n',
      skillPathHoldsTheLink: true,
    },
  )
})

// Value: protects=the recovery of an interrupted setup, which adopts the published skill only when it is the recorded file; fails_when=the comparison looks at the path and then reads the path by name, so a link that took the path is read through and another file's bytes are hashed as the published skill's; why_new=Cycle 0046 row 142 (the second place that looked first and read by name); seam=node:fs/promises lstat and the opener of the loaded deployment, at which a prepared link takes the skill's path
test('the published skill of an interrupted setup that a link replaces while Codebook compares it is not read through the link, and setup refuses the changed skill with its recovery record kept', async (context) => {
  // Arrange: a setup that was interrupted after it published the skill and before it wrote its receipt; a link to a copy with the same bytes takes the skill's path at the moment of the comparison.
  const paths = await fixture(context)
  const parent = join(paths.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  await mkdir(join(parent, 'codebook'), { recursive: true })
  await mkdir(receiptDirectory)
  const stagedPath = join(
    parent,
    '.codebook-stage-00000000-0000-0000-0000-000000000001.tmp',
  )
  await writeFile(stagedPath, INITIAL_SKILL)
  await fileSystem.link(stagedPath, paths.targetPath)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(INITIAL_SKILL).digest('hex'),
      skillVersion: '1.0.0',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
    }),
  )
  const copyPath = join(paths.homeRoot, 'a-copy.md')
  const preparedLinkPath = join(paths.homeRoot, 'prepared-link')
  await writeFile(copyPath, INITIAL_SKILL)
  if (!(await createLinkIfAllowed(copyPath, preparedLinkPath)))
    return context.skip(LINK_NOT_ALLOWED)
  const { window, readsByNameAfterTheSwap } =
    await skillWindowWhosePathIsSwapped({
      path: paths.targetPath,
      swap: () => rename(preparedLinkPath, paths.targetPath),
    })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      readsByNameAfterTheSwap,
      recoveryRecordIsKept: (
        await lstat(join(receiptDirectory, 'pending.json'))
      ).isFile(),
    },
    {
      setup:
        'Cursor skill changed during an interrupted setup; Codebook preserved it and its recovery record.',
      readsByNameAfterTheSwap: [],
      recoveryRecordIsKept: true,
    },
  )
})

// Value: protects=the reconnect of a window in a Windows editor while another window updates the shared skill; fails_when=a skill that another window replaces between this window's look at the path and its open is answered as a failed read, so the reconnect ends with a refusal although the other window's update is regular; why_new=Cycle 0046 row 142: where the open cannot refuse a link, a look and an open can see two files, also for a regular update; seam=the open flags and node:fs/promises lstat of the opener the loaded deployment reads through, after whose look the other window updates the skill
test('a reconnect whose look at the skill is overtaken by another window’s update, where the system’s open cannot refuse a link, is decided under the storage lock and finds the updated skill current', async (context) => {
  // Arrange: the skill is of the previous installation; two windows of the running one reconnect, and the other one updates the skill right after this window looked at it.
  const paths = await fixture(context)
  const directory = join(paths.homeRoot, '..')
  const previousExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.27',
    ),
    runningExtension = await installExtension(
      directory,
      'laststance.codebook-0.2.28',
    )
  await (
    await skillWindow('0.2.27')
  ).deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  let hasOtherWindowUpdated = false
  let otherWindowResult: string | undefined
  const reconnectingWindow = await skillWindow('0.2.28', {
    './utils/openWithoutFollowing': await loadOpenWithoutFollowing({
      openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
      fileSystem: {
        ...fileSystem,
        lstat: async (path: string, options?: StatOptions) => {
          const look = await fileSystem.lstat(path, options)
          if (path === paths.targetPath && !hasOtherWindowUpdated) {
            hasOtherWindowUpdated = true
            const updated = await verifyManagedCursorSkill(
              runningExtension,
              paths.storageRoot,
              paths.homeRoot,
            )
            otherWindowResult = updated.status
          }
          return look
        },
      },
    }),
  })

  // Act
  const reconnect = await statusOrRefusalOf(
    reconnectingWindow.verifyManagedCursorSkill(
      runningExtension,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      otherWindowResult,
      reconnect,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      otherWindowResult: 'updated',
      reconnect: 'current',
      skill: publisherSkillOf(runningExtension),
    },
  )
})

// Value: protects=the sentence a learner reads for a link at the managed Cursor skill's path, from each of the three entries; fails_when=a link is answered as "a non-regular skill file", which does not say that a link is there or what to do; why_new=Cycle 0046 row 142: the refusal of a link, of what is no regular file and of a replaced file each got its sentence; seam=the open flags of the opener the loaded deployment reads through
test('a link at the managed Cursor skill’s path is refused by setup, reconnect and removal with the sentence of a link, with the system’s flags and where the system’s open cannot refuse a link', async (context) => {
  // Arrange: the installed skill is moved away and a link to it stands at its path.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const movedSkillPath = join(paths.homeRoot, 'moved-SKILL.md')
  await rename(paths.targetPath, movedSkillPath)
  if (!(await createLinkIfAllowed(movedSkillPath, paths.targetPath)))
    return context.skip(LINK_NOT_ALLOWED)
  const windowAsOnWindows = await skillWindow(constants.EXTENSION_VERSION, {
    './utils/openWithoutFollowing': await loadOpenWithoutFollowing({
      openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    }),
  })
  const refusalOfALink = `Codebook will not read through a link: ${paths.targetPath}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`

  // Act
  const refusals = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    ),
    reconnect: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    ),
    setupAsOnWindows: await statusOrRefusalOf(
      windowAsOnWindows.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
    reconnectAsOnWindows: await statusOrRefusalOf(
      windowAsOnWindows.verifyManagedCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
    removalAsOnWindows: await statusOrRefusalOf(
      windowAsOnWindows.removeManagedCursorSkill(
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    { refusals, movedSkill: await readFile(movedSkillPath, 'utf8') },
    {
      refusals: {
        setup: refusalOfALink,
        reconnect: refusalOfALink,
        removal: refusalOfALink,
        setupAsOnWindows: refusalOfALink,
        reconnectAsOnWindows: refusalOfALink,
        removalAsOnWindows: refusalOfALink,
      },
      movedSkill: INITIAL_SKILL,
    },
  )
})

// Value: protects=the sentence for a skill path that holds a folder, in a Windows editor as elsewhere; fails_when=the refusal of the look, which keeps a folder from being opened where the open cannot refuse a link, reaches the learner as a bare file error instead of the sentence setup gives where the folder is opened and told by its status; why_new=Cycle 0046 row 142; seam=the open flags of the opener the loaded deployment reads through
test('a folder at the managed Cursor skill’s path is refused by setup with the sentence of a non-regular skill file, with the system’s flags and where the system’s open cannot refuse a link', async (context) => {
  // Arrange: the installed skill is replaced by a folder.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await rm(paths.targetPath)
  await mkdir(paths.targetPath)
  const windowAsOnWindows = await skillWindow(constants.EXTENSION_VERSION, {
    './utils/openWithoutFollowing': await loadOpenWithoutFollowing({
      openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    }),
  })

  // Act
  const refusals = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    ),
    setupAsOnWindows: await statusOrRefusalOf(
      windowAsOnWindows.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(refusals, {
    setup: `Codebook will not change a non-regular skill file: ${paths.targetPath}`,
    setupAsOnWindows: `Codebook will not change a non-regular skill file: ${paths.targetPath}`,
  })
})

// Value: protects=the sentence for an ownership receipt that was replaced by a link, which named a "skill file" although the receipt is Codebook's record; fails_when=the receipt is read through the link, or the refusal does not say that a link stands at the receipt's path; why_new=Cycle 0046 row 142: every read of the skill setup goes through one reader; seam=none
test('an ownership receipt of the Cursor skill that is a link is not read: setup answers that it will not read through a link, and names the receipt', async (context) => {
  // Arrange: the receipt is moved away and a link to it stands at its path.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  const movedReceiptPath = join(paths.homeRoot, 'moved-receipt.json')
  await rename(receiptPath, movedReceiptPath)
  if (!(await createLinkIfAllowed(movedReceiptPath, receiptPath)))
    return context.skip(LINK_NOT_ALLOWED)
  await writeFile(paths.sourcePath, NEXT_SKILL)

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { setup, skill: await readFile(paths.targetPath, 'utf8') },
    {
      setup: `Codebook will not read through a link: ${receiptPath}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`,
      skill: INITIAL_SKILL,
    },
  )
})

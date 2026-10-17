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
import { join, resolve, sep } from 'node:path'
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
import { loadDropSecondNameWhoseLinkIsRefused } from './utils/loadDropSecondNameWhoseLinkIsRefused'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'
import { loadSecondNameRulesOverHeldFiles } from './utils/loadSecondNameRulesOverHeldFiles'

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

// Rewritten for Cycle 0046 row 188: this test pinned the dead end (the setup was refused as interrupted for good and its record stayed). The edit is still preserved; the record is dropped and setup answers for the file as it stands.
test('an interrupted setup whose published skill the learner edited keeps that edit, drops its recovery record and answers as for a replaced skill', async (context) => {
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
  // Act
  const setup = await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  ).then(
    (result) => result.status,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      skill: await readFile(paths.targetPath, 'utf8'),
      recordsLeft: (await readdir(receiptDirectory)).filter(
        (name) => name === 'pending.json',
      ),
    },
    {
      setup: `The managed Cursor skill was replaced after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
      skill: 'Learner changed the interrupted skill',
      recordsLeft: [],
    },
  )
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

// Value: protects=the sentence a learner reads when a file of theirs takes the Cursor skill's path while a reconnect updates the skill; fails_when=the reconnect reads the link's EEXIST under the refusal as another window's storage lock, waits and tries again, and ends with "Cursor skill is missing or was changed", which names no change during setup and no step that frees the path; why_new=Cycle 0046 /ship review T4 (the refusal of a changed skill carries the link's EEXIST as its cause since row 214); seam=node:fs/promises link of the loaded deployment, before which a file of the learner takes the skill's path
test('a file that takes the Cursor skill path while a reconnect updates the skill ends the reconnect with the sentence of a skill that changed during setup', async (context) => {
  // Arrange: the skill was set up from the 0.2.26 directory; the editor now runs 0.2.27, and a file of the learner appears at the skill's path right before the update links its skill there.
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
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        if (newPath === paths.targetPath)
          await writeFile(newPath, 'A file of the learner.\n')
        return fileSystem.link(existingPath, newPath)
      },
    },
  })

  // Act
  const reconnect = await statusOrRefusalOf(
    window.verifyManagedCursorSkill(
      runningExtension,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      reconnect,
      files: await filesOfTheSetup(paths),
      fileAtTheSkillPath: await readFile(paths.targetPath, 'utf8'),
    },
    {
      reconnect: `The Cursor skill changed during setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      fileAtTheSkillPath: 'A file of the learner.\n',
    },
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
      `Cursor skill is missing or was changed: ${edited.targetPath}. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.`,
      `Cursor skill is missing or was changed: ${replaced.targetPath}. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.`,
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
      update: `The managed Cursor skill was replaced after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
      reconnect: `Cursor skill is missing or was changed: ${paths.targetPath}. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.`,
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
  calling: Promise<
    CursorSkillModule.CursorSkillResult | CursorSkillModule.CursorSkillRemoval
  >,
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
      setup: `Codebook will not read through a link: ${paths.targetPath}. Remove the link, then run Codebook: Set Up AI Chat again.`,
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

// Value: protects=a learner in a Windows editor whose skill file is replaced by a link in the instant a removal opens it; fails_when=the removal reads the link's target as the skill, or its refusal names the setup as the command to run again although the learner ran the removal, or the removal run again and its step do not end in a finished removal; why_new=Cycle 0046 row 348: the removal's sentence for a replaced file was stated by no test, which showed when each sentence's command name was traced to its constant; seam=the open flags and node:fs/promises lstat of the opener the loaded deployment reads through, after whose look a prepared link takes the skill's path
test('a link that takes the managed Cursor skill’s path between a removal’s look at it and its open, where the system’s open cannot refuse a link, is not read through: the removal answers that another file took the place of the skill and names itself as the command to run again; run again it names the link, and after the learner removes the link it finishes', async (context) => {
  // Arrange: the installed skill, a note of the learner, and a link to that note that takes the skill's path right after the removal looked at it, on a system without O_NOFOLLOW.
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
  const { window, readsByNameAfterTheSwap } =
    await skillWindowWhosePathIsSwapped({
      path: paths.targetPath,
      swap: () => rename(preparedLinkPath, paths.targetPath),
      openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    })
  const remove = (): Promise<string> =>
    statusOrRefusalOf(
      window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    )

  // Act: the removal during which the link takes the path, and then each sentence to the letter.
  const removal = await remove()
  const removalRunAgain = await remove()
  await unlink(paths.targetPath)
  const removalAfterTheLinkWasRemoved = await remove()

  // Assert
  assert.deepEqual(
    {
      removal,
      removalRunAgain,
      removalAfterTheLinkWasRemoved,
      readsByNameAfterTheSwap,
      note: await readFile(notePath, 'utf8'),
    },
    {
      removal: `Another file took the place of ${paths.targetPath} while Codebook opened it, so it was not read. Run Codebook: Remove Managed Cursor Skill again.`,
      removalRunAgain: `Codebook will not read through a link: ${paths.targetPath}. To finish the removal, remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
      removalAfterTheLinkWasRemoved: 'removed',
      readsByNameAfterTheSwap: [],
      note: 'A note of the learner.\n',
    },
  )
})

// Value: protects=the recovery of an interrupted setup, which adopts the published skill only when it is the recorded file; fails_when=the comparison looks at the path and then reads the path by name, so a link that took the path is read through and another file's bytes are hashed as the published skill's; why_new=Cycle 0046 row 142 (the second place that looked first and read by name); seam=node:fs/promises lstat and the opener of the loaded deployment, at which a prepared link takes the skill's path
test('the published skill of an interrupted setup that a link replaces while Codebook compares it is not read through the link, and setup answers for a skill folder that is not Codebook’s', async (context) => {
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

  // Assert: the link is not Codebook's skill, so the interrupted setup's record is dropped (row 188) and setup, which has no receipt, answers for the folder as it stands.
  assert.deepEqual(
    {
      setup,
      readsByNameAfterTheSwap,
      recordsLeft: (await readdir(receiptDirectory)).filter(
        (name) => name === 'pending.json',
      ),
    },
    {
      setup: `A codebook skill directory already exists in Cursor: ${join(paths.homeRoot, '.cursor', 'skills', 'codebook')}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      readsByNameAfterTheSwap: [],
      recordsLeft: [],
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
test('a link at the managed Cursor skill’s path is refused by setup, reconnect and removal with the sentence of a link, which names the command that was run as the one to run again, with the system’s flags and where the system’s open cannot refuse a link', async (context) => {
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
  const refusalOfALink = `Codebook will not read through a link: ${paths.targetPath}. Remove the link, then run Codebook: Set Up AI Chat again.`
  const refusalOfALinkUnderARemoval = `Codebook will not read through a link: ${paths.targetPath}. To finish the removal, remove the link, then run Codebook: Remove Managed Cursor Skill again.`

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
        removal: refusalOfALinkUnderARemoval,
        setupAsOnWindows: refusalOfALink,
        reconnectAsOnWindows: refusalOfALink,
        removalAsOnWindows: refusalOfALinkUnderARemoval,
      },
      movedSkill: INITIAL_SKILL,
    },
  )
})

// Value: protects=the sentence for a skill path that holds a folder, in a Windows editor as elsewhere; fails_when=the refusal of the look, which keeps a folder from being opened where the open cannot refuse a link, reaches the learner as a bare file error instead of the sentence setup gives where the folder is opened and told by its status; why_new=Cycle 0046 row 142; seam=the open flags of the opener the loaded deployment reads through
test('a folder at the managed Cursor skill’s path is refused by setup and by removal with the sentence of a non-regular skill file, which says what to do and names the command that was run, with the system’s flags and where the system’s open cannot refuse a link; after the learner deletes the folder, setup restores the skill', async (context) => {
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
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    ),
  }
  // The setup's sentence is followed to the letter.
  await rm(paths.targetPath, { recursive: true })
  const setupAfterTheFolderWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { refusals, setupAfterTheFolderWasDeleted },
    {
      refusals: {
        setup: `Codebook will not change a non-regular skill file: ${paths.targetPath}. Delete or rename what stands at that path, then run Codebook: Set Up AI Chat again.`,
        setupAsOnWindows: `Codebook will not change a non-regular skill file: ${paths.targetPath}. Delete or rename what stands at that path, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not change a non-regular skill file: ${paths.targetPath}. To finish the removal, delete or rename what stands at that path, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      setupAfterTheFolderWasDeleted: 'restored',
    },
  )
})

// Value: protects=a learner whose ownership receipt of the Cursor skill was replaced by a link; fails_when=the receipt is read through the link, or the refusal is the skill file's sentence, whose step ("remove the link, then run Codebook: Set Up AI Chat again") leads to "A codebook skill directory already exists in Cursor. …" instead of a finished setup; why_new=Cycle 0046 rows 142 and 245: a record path that holds no readable file is an invalid record, with the way out of row 212; seam=none, the real link
test('an ownership receipt of the Cursor skill that is a link is not read: setup, reconnect and removal answer that the receipt is invalid and name the receipt and the skill folder, the removal with its own command, and after the learner deletes both, setup installs the skill', async (context) => {
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

  // Act: the refusals, and then the setup's sentence followed to the letter.
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
  }
  const skillAfterTheRefusals = await readFile(paths.targetPath, 'utf8')
  await rm(receiptPath)
  await rm(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
    recursive: true,
  })
  const setupAfterBothWereDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  const refusal = sentenceOfAnInvalidRecord(
    'Cursor skill ownership receipt',
    receiptPath,
    paths,
  )
  assert.deepEqual(
    {
      refusals,
      skillAfterTheRefusals,
      movedReceiptIsKept: (await lstat(movedReceiptPath)).isFile(),
      setupAfterBothWereDeleted,
    },
    {
      refusals: {
        setup: refusal,
        reconnect: refusal,
        removal: sentenceOfAnInvalidRecord(
          'Cursor skill ownership receipt',
          receiptPath,
          paths,
          'Codebook: Remove Managed Cursor Skill',
        ),
      },
      skillAfterTheRefusals: INITIAL_SKILL,
      movedReceiptIsKept: true,
      setupAfterBothWereDeleted: 'installed',
    },
  )
})

// Value: protects=a learner at whose record path of the Cursor skill a folder stands; fails_when=setup and removal answer "Codebook will not change a non-regular skill file: <…/pending.json>", which names the wrong thing and no next step, so setup, reconnect and removal are refused for good; why_new=Cycle 0046 row 245; seam=none, the real folders
test('a folder at the path of a setup record or of a removal record of the Cursor skill is answered as an invalid record that names the record and the skill folder, by the setup with its command and by the removal with its own', async (context) => {
  // Arrange: two installed skills; a folder stands where the setup's record would be for one, and where the removal's record would be for the other.
  const withSetupRecord = await fixture(context),
    withRemovalRecord = await fixture(context)
  for (const paths of [withSetupRecord, withRemovalRecord])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  const pendingPath = join(
    withSetupRecord.storageRoot,
    'cursor-skill',
    'pending.json',
  )
  const removalPath = join(
    withRemovalRecord.storageRoot,
    'cursor-skill',
    'removal.json',
  )
  await mkdir(pendingPath)
  await mkdir(removalPath)

  // Act
  const refusals = {
    setupAtTheSetupRecord: await statusOrRefusalOf(
      deployCursorSkill(
        withSetupRecord.extensionPath,
        withSetupRecord.storageRoot,
        withSetupRecord.homeRoot,
      ),
    ),
    setupAtTheRemovalRecord: await statusOrRefusalOf(
      deployCursorSkill(
        withRemovalRecord.extensionPath,
        withRemovalRecord.storageRoot,
        withRemovalRecord.homeRoot,
      ),
    ),
    removalAtTheRemovalRecord: await statusOrRefusalOf(
      removeManagedCursorSkill(
        withRemovalRecord.storageRoot,
        withRemovalRecord.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(refusals, {
    setupAtTheSetupRecord: sentenceOfAnInvalidRecord(
      'Cursor skill pending ownership record',
      pendingPath,
      withSetupRecord,
    ),
    setupAtTheRemovalRecord: sentenceOfAnInvalidRecord(
      'Cursor skill pending removal record',
      removalPath,
      withRemovalRecord,
    ),
    removalAtTheRemovalRecord: sentenceOfAnInvalidRecord(
      'Cursor skill pending removal record',
      removalPath,
      withRemovalRecord,
      'Codebook: Remove Managed Cursor Skill',
    ),
  })
})

// Value: protects=the same where the system's open cannot refuse a link and another file takes the receipt's path between the look at it and its open; fails_when=that receipt is answered with the skill file's sentence "Another file took the place of <…/receipt.json> …", or is read; why_new=Cycle 0046 row 245; seam=node:fs/promises lstat of the loaded deployment and its opener, at which another file takes the receipt's path
test('an ownership receipt of the Cursor skill that another file replaces between the look at it and its open, where the system’s open cannot refuse a link, is answered as an invalid record', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  const otherFilePath = join(paths.homeRoot, 'another-file.json')
  await writeFile(otherFilePath, '{}')
  const { window } = await skillWindowWhosePathIsSwapped({
    path: receiptPath,
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    swap: () => rename(otherFilePath, receiptPath),
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
  assert.equal(
    setup,
    sentenceOfAnInvalidRecord(
      'Cursor skill ownership receipt',
      receiptPath,
      paths,
    ),
  )
})

/** What a learner writes into the skill file Codebook installed. */
const EDITED_SKILL = 'An edit made by the learner.\n'

/**
 * The files of a test's skill setup as they stand: the skill folder, Codebook's temporary names in the skills folder, and the recovery records in Codebook's storage.
 * @returns The sorted entry names of each.
 */
async function filesOfTheSetup(paths: {
  homeRoot: string
  storageRoot: string
}): Promise<{
  skillFolder: string[]
  temporaryNames: string[]
  records: string[]
}> {
  const skills = join(paths.homeRoot, '.cursor', 'skills')
  return {
    skillFolder: (await readdir(join(skills, 'codebook'))).sort(),
    temporaryNames: (await readdir(skills)).filter((name) =>
      name.startsWith('.codebook-'),
    ),
    records: (await readdir(join(paths.storageRoot, 'cursor-skill')))
      .filter((name) => name === 'pending.json' || name === 'removal.json')
      .sort(),
  }
}

/**
 * Leaves the record of a setup that updates the installed skill and has moved it away, as a refusal or a crash leaves it: the staged new skill, and `pending.json` with the receipt as the previous owner and the names of the move.
 * @returns The record's path and the two names it holds.
 */
async function writeUpdateRecord(paths: {
  homeRoot: string
  storageRoot: string
  targetPath: string
}): Promise<{
  pendingPath: string
  displacedPath: string
  stagedPath: string
}> {
  const receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  const stagedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    '.codebook-stage-00000000-0000-0000-0000-000000000188.tmp',
  )
  const displacedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    '.codebook-displaced-00000000-0000-0000-0000-000000000188.tmp',
  )
  const pendingPath = join(receiptDirectory, 'pending.json')
  await writeFile(stagedPath, NEXT_SKILL)
  const staged = await lstat(stagedPath)
  const previous: unknown = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  await writeFile(
    pendingPath,
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
      retiredPath: join(
        receiptDirectory,
        'retired-00000000-0000-0000-0000-000000000188.SKILL.md',
      ),
    }),
  )
  return { pendingPath, displacedPath, stagedPath }
}

/**
 * Leaves the record of a removal of the installed skill, as a refusal or a crash leaves it: `removal.json` with the receipt as the owner and the names of the move.
 * @returns The record's path and the displaced name it holds.
 */
async function writeRemovalRecord(paths: {
  homeRoot: string
  storageRoot: string
  targetPath: string
}): Promise<{ removalPath: string; displacedPath: string }> {
  const receiptDirectory = join(paths.storageRoot, 'cursor-skill')
  const displacedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    '.codebook-displaced-00000000-0000-0000-0000-000000000189.tmp',
  )
  const removalPath = join(receiptDirectory, 'removal.json')
  const owner: unknown = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  await writeFile(
    removalPath,
    JSON.stringify({
      schemaVersion: 1,
      targetPath: paths.targetPath,
      displacedPath,
      retiredPath: join(
        receiptDirectory,
        'retired-00000000-0000-0000-0000-000000000189.SKILL.md',
      ),
      owner,
    }),
  )
  return { removalPath, displacedPath }
}

/**
 * Loads the skill deployment as a window in which the learner's editor writes the skill file in the instant before Codebook moves it away, the moment between Codebook's last check of the file and its move.
 * @param skillPath - The managed skill path.
 * @returns The window.
 */
async function skillWindowWhoseSkillIsEditedBeforeItsMove(
  skillPath: string,
): Promise<typeof CursorSkillModule> {
  return skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      rename: async (from: string, to: string) => {
        if (from === skillPath) await writeFile(from, EDITED_SKILL)
        return fileSystem.rename(from, to)
      },
    },
  })
}

// Value: protects=a learner whose editor saves the skill file in the instant between setup's last check and its move, and every setup and removal after it; fails_when=setup keeps its recovery record and a second name of the learner's file, after which setup answers "Cursor skill changed during an interrupted setup; …" and removal answers "Cursor skill setup is interrupted. Run Codebook: Set Up AI Chat to recover before removal." for good; why_new=Cycle 0046 row 188 (the skill's setup); seam=node:fs/promises rename of the loaded deployment, before whose move the skill file is written
test('a Cursor skill that is edited between setup’s last check and its move is put back and kept: setup says what to do, leaves no record, the next setup and removal answer for the edit, and after the learner undoes the edit in the file, setup updates the skill', async (context) => {
  // Arrange: the installed skill; the extension brings a new one, so setup moves the old one away; the learner's editor writes the file right before that move.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindowWhoseSkillIsEditedBeforeItsMove(
    paths.targetPath,
  )

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const nextSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const nextRemoval = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const skillAfterTheRefusals = await readFile(paths.targetPath, 'utf8')
  // The setup's sentence is followed to the letter: the edit is undone in the same file.
  await writeFile(paths.targetPath, INITIAL_SKILL)
  const setupAfterTheEditWasUndone = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      nextSetup,
      nextRemoval,
      skillAfterTheRefusals,
      setupAfterTheEditWasUndone,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The Cursor skill was edited during setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      nextSetup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      nextRemoval: `The Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      skillAfterTheRefusals: EDITED_SKILL,
      setupAfterTheEditWasUndone: 'updated',
      skill: NEXT_SKILL,
    },
  )
})

// Value: protects=a learner whose setup 0.2.29.0 (or an earlier build of this cycle) refused with "The Cursor skill changed during setup; Codebook preserved the displaced file and recovery record." and who updates the extension; fails_when=the record and the second name that refusal left make setup answer "Cursor skill changed during an interrupted setup; Codebook preserved it and its recovery record." and removal point back to setup, for good; why_new=Cycle 0046 row 188 (the skill's setup recovery); seam=none, the files as that refusal leaves them
test('the record, the staged file and the second name that a refused setup of an edited Cursor skill left are cleared by the next setup, which answers for the edit, and removal no longer points back to setup', async (context) => {
  // Arrange: the installed skill was edited, moved away, found changed and linked back; the staged new skill and the record stayed.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const { displacedPath } = await writeUpdateRecord(paths)
  await writeFile(paths.targetPath, EDITED_SKILL)
  await fileSystem.link(paths.targetPath, displacedPath)

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      removal,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      removal: `The Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=an edited skill file that a setup moved away and could not put back (the editor was closed in that instant); fails_when=the next setup refuses for good, or the learner's file stays under Codebook's temporary name while the skill's path is empty and setup installs its own skill there; why_new=Cycle 0046 row 188: the same state without the link back; seam=none, the files as a setup leaves them when it ends between its move and its link back
test('an edited Cursor skill that a setup moved away and never put back is put back at its path by the next setup, which answers for the edit', async (context) => {
  // Arrange: the edited skill stands under its displaced name alone; the staged new skill and the record stayed.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const { displacedPath } = await writeUpdateRecord(paths)
  await writeFile(paths.targetPath, EDITED_SKILL)
  await rename(paths.targetPath, displacedPath)

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      files: await filesOfTheSetup(paths),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=two files of the learner when a setup moved an edited skill away and another file took the skill's path before it could be put back; fails_when=Codebook drops its record and forgets the moved file, or removes one of the two, or refuses without saying where the moved file is and how to start over; why_new=Cycle 0046 row 188: a record that is kept says what the learner does next; seam=none, the files as that state leaves them
test('an edited Cursor skill that a setup moved away, with another file at the skill’s path now, is kept with its record: the refusal names the kept file and how to start over, and after the record is deleted setup answers', async (context) => {
  // Arrange: the edited skill stands under its displaced name; a newer file stands at the skill's path.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const { pendingPath, displacedPath } = await writeUpdateRecord(paths)
  await writeFile(paths.targetPath, EDITED_SKILL)
  await rename(paths.targetPath, displacedPath)
  await writeFile(paths.targetPath, 'A newer file of the learner.\n')

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const filesWhileTheRecordIsKept = {
    skill: await readFile(paths.targetPath, 'utf8'),
    movedAway: await readFile(displacedPath, 'utf8'),
    records: (await filesOfTheSetup(paths)).records,
  }
  await rm(pendingPath)
  const setupAfterTheRecordWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { setup, filesWhileTheRecordIsKept, setupAfterTheRecordWasDeleted },
    {
      setup: `Cursor skill changed during an interrupted setup: ${paths.targetPath}. Codebook preserved it and its recovery record. The file Codebook had moved away is kept as ${displacedPath}. To start over, delete ${pendingPath}, then run Codebook: Set Up AI Chat again.`,
      filesWhileTheRecordIsKept: {
        skill: 'A newer file of the learner.\n',
        movedAway: EDITED_SKILL,
        records: ['pending.json'],
      },
      setupAfterTheRecordWasDeleted: `The managed Cursor skill was replaced after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
    },
  )
})

// Value: protects=a learner who edits the skill file in the instant after a first setup published it; fails_when=setup keeps its record (every later setup is refused as interrupted) or leaves Codebook's staged name in ~/.cursor/skills as a second name of the learner's file; why_new=Cycle 0046 row 188 (the published skill); seam=node:fs/promises link of the loaded deployment, after which the published skill is written
test('a Cursor skill that is edited right after a first setup published it is kept under its one name: setup says what to do, leaves no record, and the next setup answers that the skill folder is not Codebook’s, and after the learner deletes the file, setup installs the skill', async (context) => {
  // Arrange: no skill yet; the learner's editor writes the skill file right after setup linked it into place.
  const paths = await fixture(context)
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await fileSystem.link(existingPath, newPath)
        if (newPath === paths.targetPath) await writeFile(newPath, EDITED_SKILL)
      },
    },
  })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const nextSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const skillAfterTheRefusals = await readFile(paths.targetPath, 'utf8')
  // The setup's sentence is followed to the letter.
  await rm(paths.targetPath)
  const setupAfterTheFileWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      nextSetup,
      skillAfterTheRefusals,
      setupAfterTheFileWasDeleted,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The published Cursor skill changed during setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      nextSetup: `A codebook skill directory already exists in Cursor: ${join(paths.homeRoot, '.cursor', 'skills', 'codebook')}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      skillAfterTheRefusals: EDITED_SKILL,
      setupAfterTheFileWasDeleted: 'installed',
      skill: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner whose editor saves the skill file in the instant between the removal's check and its move, and every setup and removal after it; fails_when=the removal keeps its record and a second name of the learner's file, after which setup and removal answer "Cursor skill changed during interrupted removal; …" for good; why_new=Cycle 0046 row 188 (the skill's removal); seam=node:fs/promises rename of the loaded deployment, before whose move the skill file is written
test('a Cursor skill that is edited between the removal’s check and its move is put back and kept: the removal says so, leaves no record, and the next removal and setup answer for the edit', async (context) => {
  // Arrange: the installed skill; the learner's editor writes the file right before the removal moves it.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const window = await skillWindowWhoseSkillIsEditedBeforeItsMove(
    paths.targetPath,
  )

  // Act
  const removal = await statusOrRefusalOf(
    window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const filesAfterTheRemoval = await filesOfTheSetup(paths)
  const nextRemoval = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const nextSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      filesAfterTheRemoval,
      nextRemoval,
      nextSetup,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      removal: `The Cursor skill changed during removal: ${paths.targetPath}. Codebook did not remove it and left it in place. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      filesAfterTheRemoval: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      nextRemoval: `The Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      nextSetup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=a learner whose removal 0.2.29.0 (or an earlier build of this cycle) refused with "The Cursor skill changed during removal; Codebook preserved the displaced file and recovery record." and who updates the extension; fails_when=the record and the second name that refusal left make every setup and removal answer "Cursor skill changed during interrupted removal; Codebook preserved it and the displaced file." for good; why_new=Cycle 0046 row 188 (the skill's removal recovery); seam=none, the files as that refusal leaves them
test('the record and the second name that a refused removal of an edited Cursor skill left are cleared by the next setup, which answers for the edit, and so does the next removal', async (context) => {
  // Arrange: the installed skill was edited, moved away, found changed and linked back; the record stayed.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const { displacedPath } = await writeRemovalRecord(paths)
  await writeFile(paths.targetPath, EDITED_SKILL)
  await fileSystem.link(paths.targetPath, displacedPath)

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      removal,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      removal: `The Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=the learner who meets one of the states a removal's record is kept for; fails_when=the refusal names no file and no next step, so the learner cannot tell what to delete to get setup and removal back; why_new=Cycle 0046 row 188: every sentence of a record that is kept says what the learner does next; seam=none, the files as each state leaves them
test('each refusal that keeps a removal’s record of the Cursor skill names the record, every file it keeps and how to start over, with the removal as the command to run again: two different files at the two names, a foreign file at the displaced name, a skill that is gone before its receipt said so, and a moved skill whose retained name is taken', async (context) => {
  // Arrange: four setups, each with a removal's record. First: an edited skill under the displaced name and another file at the skill's path. Second: Codebook's skill at its path and a foreign file at the displaced name. Third: neither name holds anything, and the receipt still says installed. Fourth: Codebook's skill under the displaced name, and a file under the retained name too.
  const twoFiles = await fixture(context),
    foreignFile = await fixture(context),
    goneSkill = await fixture(context),
    retainedNameTaken = await fixture(context)
  for (const paths of [twoFiles, foreignFile, goneSkill, retainedNameTaken])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  const first = await writeRemovalRecord(twoFiles)
  await writeFile(twoFiles.targetPath, EDITED_SKILL)
  await rename(twoFiles.targetPath, first.displacedPath)
  await writeFile(twoFiles.targetPath, 'A newer file of the learner.\n')
  const second = await writeRemovalRecord(foreignFile)
  await writeFile(second.displacedPath, 'A foreign file.\n')
  const third = await writeRemovalRecord(goneSkill)
  await rm(goneSkill.targetPath)
  const fourth = await writeRemovalRecord(retainedNameTaken)
  await rename(retainedNameTaken.targetPath, fourth.displacedPath)
  await writeFile(
    join(
      retainedNameTaken.storageRoot,
      'cursor-skill',
      'retired-00000000-0000-0000-0000-000000000189.SKILL.md',
    ),
    'A file under the retained name.\n',
  )

  // Act
  const refusals = {
    twoFiles: await statusOrRefusalOf(
      removeManagedCursorSkill(twoFiles.storageRoot, twoFiles.homeRoot),
    ),
    foreignFile: await statusOrRefusalOf(
      removeManagedCursorSkill(foreignFile.storageRoot, foreignFile.homeRoot),
    ),
    goneSkill: await statusOrRefusalOf(
      removeManagedCursorSkill(goneSkill.storageRoot, goneSkill.homeRoot),
    ),
    retainedNameTaken: await statusOrRefusalOf(
      removeManagedCursorSkill(
        retainedNameTaken.storageRoot,
        retainedNameTaken.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      movedAwayOfTheFirst: await readFile(first.displacedPath, 'utf8'),
    },
    {
      refusals: {
        twoFiles: `Cursor skill changed during interrupted removal: ${twoFiles.targetPath}. Codebook preserved it and the displaced file (${first.displacedPath}). To start over, delete ${first.removalPath}, then run Codebook: Remove Managed Cursor Skill again.`,
        foreignFile: `The displaced Cursor skill changed during removal; Codebook preserved it as ${second.displacedPath}, with its recovery record. To start over, delete ${second.removalPath}, then run Codebook: Remove Managed Cursor Skill again.`,
        goneSkill: `Removed Cursor skill is missing before its receipt was updated; Codebook preserved the recovery record. To start over, delete ${third.removalPath}, then run Codebook: Remove Managed Cursor Skill again.`,
        retainedNameTaken: `Cursor skill displacement and private retention both exist; Codebook preserved both for inspection: ${fourth.displacedPath} and ${join(retainedNameTaken.storageRoot, 'cursor-skill', 'retired-00000000-0000-0000-0000-000000000189.SKILL.md')}. To start over, delete ${fourth.removalPath}, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      movedAwayOfTheFirst: EDITED_SKILL,
    },
  )
})

// Value: protects=the learner who meets one of the states a setup's record is kept for after its skill was published, and what deleting that record leaves; fails_when=the refusal names no record and no next step, or tells the learner to delete the one file that names where their bytes are kept without naming that place, or the deleted record leaves the staged file behind for good; why_new=Cycle 0046 rows 188 and 247; seam=none, the files as each state leaves them
test('each refusal that keeps a setup’s record of the Cursor skill names the record, every file it keeps and how to start over, and leaves no staged file: a displaced and a retained file that both exist, a retained file that changed, and a displacement without its previous owner; after the learner deletes the record, setup finds the skill current', async (context) => {
  // Arrange: three updates that published the new skill and were interrupted before they retained the old one. First: the old skill stands under its displaced name and a file stands under the retained name too. Second: the retained file is not the old skill. Third: the record names a displaced file and no previous owner.
  const bothExist = await fixture(context),
    retainedChanged = await fixture(context),
    noPreviousOwner = await fixture(context)
  const records: Record<string, string> = {},
    displaced: Record<string, string> = {},
    retained: Record<string, string> = {}
  for (const [name, paths] of Object.entries({
    bothExist,
    retainedChanged,
    noPreviousOwner,
  })) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.sourcePath, NEXT_SKILL)
    const record = await writeUpdateRecord(paths)
    const retainedPath = join(
      paths.storageRoot,
      'cursor-skill',
      'retired-00000000-0000-0000-0000-000000000188.SKILL.md',
    )
    await rename(paths.targetPath, record.displacedPath)
    await fileSystem.link(record.stagedPath, paths.targetPath)
    if (name === 'bothExist') await writeFile(retainedPath, 'Another file.\n')
    if (name === 'retainedChanged')
      await rename(record.displacedPath, retainedPath).then(() =>
        writeFile(retainedPath, 'The retained file, changed.\n'),
      )
    if (name === 'noPreviousOwner') {
      const written: { previous?: unknown } = JSON.parse(
        await readFile(record.pendingPath, 'utf8'),
      )
      delete written.previous
      await writeFile(record.pendingPath, JSON.stringify(written))
    }
    records[name] = record.pendingPath
    displaced[name] = record.displacedPath
    retained[name] = retainedPath
  }
  const setUp = (paths: typeof bothExist): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Act: each refusal, what it left under Codebook's temporary names, and then its way out followed to the letter.
  const refusals = {
    bothExist: await setUp(bothExist),
    retainedChanged: await setUp(retainedChanged),
    noPreviousOwner: await setUp(noPreviousOwner),
  }
  const stagedFilesAfterTheRefusals = [
    (await filesOfTheSetup(bothExist)).temporaryNames,
    (await filesOfTheSetup(retainedChanged)).temporaryNames,
    (await filesOfTheSetup(noPreviousOwner)).temporaryNames,
  ]
  for (const recordPath of Object.values(records)) await rm(recordPath)
  const setupsAfterTheRecordWasDeleted = {
    bothExist: await setUp(bothExist),
    retainedChanged: await setUp(retainedChanged),
    noPreviousOwner: await setUp(noPreviousOwner),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      stagedFilesAfterTheRefusals,
      setupsAfterTheRecordWasDeleted,
      keptRetainedFile: await readFile(retained.retainedChanged ?? '', 'utf8'),
    },
    {
      refusals: {
        bothExist: `Cursor skill displacement and private retention both exist; Codebook preserved both for inspection: ${displaced.bothExist} and ${retained.bothExist}. To start over, delete ${records.bothExist}, then run Codebook: Set Up AI Chat again.`,
        retainedChanged: `The displaced Cursor skill changed; Codebook retained its actual bytes privately for recovery as ${retained.retainedChanged}. To start over, delete ${records.retainedChanged}, then run Codebook: Set Up AI Chat again.`,
        noPreviousOwner: `Cursor skill displacement has no complete recovery record; Codebook left what stands under the displaced name ${displaced.noPreviousOwner} as it is. To start over, delete ${records.noPreviousOwner}, then run Codebook: Set Up AI Chat again.`,
      },
      stagedFilesAfterTheRefusals: [[], [], []],
      setupsAfterTheRecordWasDeleted: {
        bothExist: 'current',
        retainedChanged: 'current',
        noPreviousOwner: 'current',
      },
      keptRetainedFile: 'The retained file, changed.\n',
    },
  )
})

// Value: protects=a learner whose editor saves the skill file while setup stages its update, before setup moves anything; fails_when=setup refuses and keeps its staged file and its record, after which every setup is refused as interrupted and removal points back to setup; why_new=Cycle 0046 row 188 (the check before the move); seam=node:fs/promises lstat of the loaded deployment, at whose look at the staged file the skill file is written
test('a Cursor skill that is edited while setup stages its update, before anything is moved, is kept: setup says what to do, leaves no record and no staged file, the next setup answers for the edit, and after the learner deletes the file, setup installs the skill again', async (context) => {
  // Arrange: the installed skill; the extension brings a new one; the learner's editor writes the skill file when setup looks at the file it staged.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  let isSkillEdited = false
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string, options?: StatOptions) => {
        if (path.includes('.codebook-stage-') && !isSkillEdited) {
          isSkillEdited = true
          await writeFile(paths.targetPath, EDITED_SKILL)
        }
        return fileSystem.lstat(path, options)
      },
    },
  })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const nextSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const skillAfterTheRefusals = await readFile(paths.targetPath, 'utf8')
  // The setup's sentence is followed to the letter, by its second way.
  await rm(paths.targetPath)
  const setupAfterTheFileWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      nextSetup,
      skillAfterTheRefusals,
      setupAfterTheFileWasDeleted,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The Cursor skill was edited during setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      nextSetup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      skillAfterTheRefusals: EDITED_SKILL,
      setupAfterTheFileWasDeleted: 'restored',
      skill: NEXT_SKILL,
    },
  )
})

// Value: protects=the learner who put a file of their own in place of the skill Codebook installed; fails_when=setup or removal answer that the file was preserved and say nothing more, so the learner does not learn that Codebook leaves the file alone and that taking it away lets setup install the skill again and lets the removal finish; why_new=Cycle 0046 row 211: these are the sentences a learner reads after a recovery goes on; seam=none, the real files
test('a file that took the place of the installed Cursor skill is left alone by setup and by removal, which say what to do: after the learner deletes it, setup installs the skill again, and after the learner renames it, the removal finishes', async (context) => {
  // Arrange: two setups whose skill file the learner replaced by a file of their own.
  const forSetup = await fixture(context),
    forRemoval = await fixture(context)
  for (const paths of [forSetup, forRemoval]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    const replacement = join(paths.homeRoot, 'replacement.md')
    await writeFile(replacement, 'A file of the learner.\n')
    await rename(replacement, paths.targetPath)
  }

  // Act: each refusal is followed to the letter.
  const setup = await statusOrRefusalOf(
    deployCursorSkill(
      forSetup.extensionPath,
      forSetup.storageRoot,
      forSetup.homeRoot,
    ),
  )
  const fileAfterTheRefusedSetup = await readFile(forSetup.targetPath, 'utf8')
  await rm(forSetup.targetPath)
  const setupAfterTheFileWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(
      forSetup.extensionPath,
      forSetup.storageRoot,
      forSetup.homeRoot,
    ),
  )
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(forRemoval.storageRoot, forRemoval.homeRoot),
  )
  const fileAfterTheRefusedRemoval = await readFile(
    forRemoval.targetPath,
    'utf8',
  )
  await rename(
    forRemoval.targetPath,
    join(forRemoval.homeRoot, '.cursor', 'skills', 'codebook', 'mine.md'),
  )
  const removalAfterTheFileWasRenamed = await statusOrRefusalOf(
    removeManagedCursorSkill(forRemoval.storageRoot, forRemoval.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      fileAfterTheRefusedSetup,
      setupAfterTheFileWasDeleted,
      skillAfterThatSetup: await readFile(forSetup.targetPath, 'utf8'),
      removal,
      fileAfterTheRefusedRemoval,
      removalAfterTheFileWasRenamed,
      skillFolderAfterThatRemoval: await readdir(
        join(forRemoval.homeRoot, '.cursor', 'skills', 'codebook'),
      ),
    },
    {
      setup: `The managed Cursor skill was replaced after setup: ${forSetup.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
      fileAfterTheRefusedSetup: 'A file of the learner.\n',
      setupAfterTheFileWasDeleted: 'restored',
      skillAfterThatSetup: INITIAL_SKILL,
      removal: `The Cursor skill was replaced after setup: ${forRemoval.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      fileAfterTheRefusedRemoval: 'A file of the learner.\n',
      removalAfterTheFileWasRenamed: 'removed',
      skillFolderAfterThatRemoval: ['mine.md'],
    },
  )
})

// Value: protects=the learner who edited the installed skill and then asks Codebook to remove its Cursor setup; fails_when=the removal says the edit was preserved and nothing more, or still refuses after the learner deleted the file as told ("No installed Codebook-owned Cursor skill was found"), so the registration and the empty MCP config can never be removed; why_new=Cycle 0046 row 211: the sentence names a next step, and that step must end the removal; seam=none, the real files
test('an edited Cursor skill is left alone by removal, which says what to do: after the learner deletes the file, the removal finishes, the empty skill folder is gone and a later setup installs the skill anew', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.targetPath, 'An edit made by the learner.\n')

  // Act: the refusal is followed to the letter.
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const fileAfterTheRefusedRemoval = await readFile(paths.targetPath, 'utf8')
  await rm(paths.targetPath)
  const removalAfterTheFileWasDeleted = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const skillFolderAfterThatRemoval = await readdir(
    join(paths.homeRoot, '.cursor', 'skills'),
  )
  const removalOnceMore = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const laterSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      fileAfterTheRefusedRemoval,
      removalAfterTheFileWasDeleted,
      skillFolderAfterThatRemoval,
      removalOnceMore,
      laterSetup,
    },
    {
      removal: `The Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      fileAfterTheRefusedRemoval: 'An edit made by the learner.\n',
      removalAfterTheFileWasDeleted: 'removed',
      skillFolderAfterThatRemoval: [],
      removalOnceMore: 'already-removed',
      laterSetup: 'restored',
    },
  )
})

// Value: protects=the learner who deletes the whole skill folder instead of the one file and then asks Codebook to remove its Cursor setup; fails_when=the removal answers "Codebook will not follow a missing or redirected skill directory" for good, so the registration and the empty MCP config can never be removed; why_new=Cycle 0046 row 211, found while working: the next step of the removal's sentences must end the removal also when the learner removed more than the file; seam=none, the real files
test('a removal whose skill folder the learner deleted finishes: the receipt records the removal and a later setup installs the skill anew', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await rm(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
    recursive: true,
  })

  // Act
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  const receipt: unknown = JSON.parse(
    await readFile(
      join(paths.storageRoot, 'cursor-skill', 'receipt.json'),
      'utf8',
    ),
  )
  const laterSetup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      receiptSaysInstalled:
        typeof receipt === 'object' &&
        receipt !== null &&
        'installed' in receipt
          ? receipt.installed
          : 'a receipt without that field',
      laterSetup,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      removal: 'removed',
      receiptSaysInstalled: false,
      laterSetup: 'restored',
      skill: INITIAL_SKILL,
    },
  )
})

/**
 * States the whole refusal when setup-record regression tests compare what a learner reads for an untrusted record.
 * @param subject - What is invalid, as the sentence begins.
 * @param recordPath - The record file the sentence names.
 * @param paths - The test's setup, for the skill folder the sentence names.
 * @param commandToRunAgain - The command the sentence names as the one to run again: the setup, unless the test ran the removal.
 * @returns The whole sentence.
 * @example
 * sentenceOfAnInvalidRecord('Cursor skill receipt', '/private/receipt.json', { homeRoot: '/home/user' })
 * // => 'Cursor skill receipt is invalid; no skill file was changed. To start over, delete /private/receipt.json and the folder /home/user/.cursor/skills/codebook (first copy anything of yours out of that folder), then run Codebook: Set Up AI Chat again.'
 */
function sentenceOfAnInvalidRecord(
  subject: string,
  recordPath: string,
  paths: { homeRoot: string },
  commandToRunAgain = 'Codebook: Set Up AI Chat',
): string {
  return `${subject} is invalid; no skill file was changed. To start over, delete ${recordPath} and the folder ${join(paths.homeRoot, '.cursor', 'skills', 'codebook')} (first copy anything of yours out of that folder), then run ${commandToRunAgain} again.`
}

// Value: protects=a learner whose receipt of the Cursor skill was edited by hand or damaged; fails_when=setup, reconnect and removal are refused for good with a sentence that names no file and no way out, or the way out it names does not end in a finished setup (deleting the receipt alone leads to "A codebook skill directory already exists in Cursor. …"); why_new=Cycle 0046 row 212 (the receipt); seam=none, the real files
test('a Cursor skill receipt that was edited by hand is refused by setup, reconnect and removal with a sentence that names the receipt and the skill folder, and after the learner deletes both, setup installs the skill', async (context) => {
  // Arrange: the installed skill, and a receipt whose inode someone wrote as a word.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  const receipt: object = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(receiptPath, JSON.stringify({ ...receipt, inode: 'mine' }))

  // Act: the refusal is followed to the letter.
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
  }
  const skillAfterTheRefusals = await readFile(paths.targetPath, 'utf8')
  await rm(receiptPath)
  // The receipt alone is not enough, which is why the sentence names the folder too.
  const setupAfterTheReceiptAloneWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  await rm(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
    recursive: true,
  })
  const setupAfterBothWereDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  const refusal = sentenceOfAnInvalidRecord(
    'Cursor skill ownership receipt',
    receiptPath,
    paths,
  )
  assert.deepEqual(
    {
      refusals,
      skillAfterTheRefusals,
      setupAfterTheReceiptAloneWasDeleted,
      setupAfterBothWereDeleted,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      refusals: {
        setup: refusal,
        reconnect: refusal,
        removal: sentenceOfAnInvalidRecord(
          'Cursor skill ownership receipt',
          receiptPath,
          paths,
          'Codebook: Remove Managed Cursor Skill',
        ),
      },
      skillAfterTheRefusals: INITIAL_SKILL,
      setupAfterTheReceiptAloneWasDeleted: `A codebook skill directory already exists in Cursor: ${join(paths.homeRoot, '.cursor', 'skills', 'codebook')}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      setupAfterBothWereDeleted: 'installed',
      skill: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner whose record of an interrupted setup or removal of the Cursor skill was edited by hand or damaged; fails_when=every setup is refused for good with a sentence that names no file and no way out, or the way out it names does not end in a finished setup; why_new=Cycle 0046 row 212 (the setup's record and the removal's record); seam=none, the real files
test('a setup record and a removal record of the Cursor skill that were edited by hand are each refused with a sentence that names the record and the skill folder, and after the learner deletes both, setup restores the skill', async (context) => {
  // Arrange: two installed skills; beside one a setup's record, beside the other a removal's record, each with a schema version this build does not know.
  const withSetupRecord = await fixture(context),
    withRemovalRecord = await fixture(context)
  for (const paths of [withSetupRecord, withRemovalRecord])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  const setupRecord = await writeUpdateRecord(withSetupRecord)
  const removalRecord = await writeRemovalRecord(withRemovalRecord)
  for (const recordPath of [
    setupRecord.pendingPath,
    removalRecord.removalPath,
  ]) {
    const record: object = JSON.parse(await readFile(recordPath, 'utf8'))
    await writeFile(recordPath, JSON.stringify({ ...record, schemaVersion: 2 }))
  }

  // Act: each refusal is followed to the letter.
  const outcomes: Record<string, string[]> = {}
  for (const [name, paths, recordPath] of [
    ['setupRecord', withSetupRecord, setupRecord.pendingPath],
    ['removalRecord', withRemovalRecord, removalRecord.removalPath],
  ] as const) {
    const refusal = await statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )
    await rm(recordPath)
    await rm(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
      recursive: true,
    })
    outcomes[name] = [
      refusal,
      await statusOrRefusalOf(
        deployCursorSkill(
          paths.extensionPath,
          paths.storageRoot,
          paths.homeRoot,
        ),
      ),
      await readFile(paths.targetPath, 'utf8'),
    ]
  }

  // Assert
  assert.deepEqual(outcomes, {
    setupRecord: [
      sentenceOfAnInvalidRecord(
        'Cursor skill pending ownership record',
        setupRecord.pendingPath,
        withSetupRecord,
      ),
      'restored',
      INITIAL_SKILL,
    ],
    removalRecord: [
      sentenceOfAnInvalidRecord(
        'Cursor skill pending removal record',
        removalRecord.removalPath,
        withRemovalRecord,
      ),
      'restored',
      INITIAL_SKILL,
    ],
  })
})

// Value: protects=the learner who has to find the one file that is wrong among Codebook's records of the Cursor skill; fails_when=a refusal names another file than the one that holds the invalid part (a setup's record with an invalid previous owner blamed on the receipt), or a record that is no JSON, or one with an invalid path, ends with a bare parser error or a sentence without a way out; why_new=Cycle 0046 row 212: every check of a record refuses through one function; seam=none, the real files
test('each invalid part of a Cursor skill record is refused with the sentence of an invalid record that names the file it stands in: a receipt that is no JSON, and a setup record with an invalid displaced name, retained name or previous owner', async (context) => {
  // Arrange: four installed skills, each with one record damaged in one way.
  const damages = {
    receiptIsNoJson: await fixture(context),
    displacedName: await fixture(context),
    retainedName: await fixture(context),
    previousOwner: await fixture(context),
  }
  const recordPaths: Record<string, string> = {}
  for (const [damage, paths] of Object.entries(damages)) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    if (damage === 'receiptIsNoJson') {
      recordPaths[damage] = join(
        paths.storageRoot,
        'cursor-skill',
        'receipt.json',
      )
      await writeFile(recordPaths[damage], '{"schemaVersion":1,')
      continue
    }
    const { pendingPath } = await writeUpdateRecord(paths)
    const record: { previous: object } = JSON.parse(
      await readFile(pendingPath, 'utf8'),
    )
    await writeFile(
      pendingPath,
      JSON.stringify({
        ...record,
        ...(damage === 'displacedName'
          ? { displacedPath: join(paths.homeRoot, 'elsewhere.tmp') }
          : {}),
        ...(damage === 'retainedName'
          ? { retiredPath: join(paths.homeRoot, 'elsewhere.md') }
          : {}),
        ...(damage === 'previousOwner'
          ? { previous: { ...record.previous, skillSha256: 'no digest' } }
          : {}),
      }),
    )
    recordPaths[damage] = pendingPath
  }

  // Act
  const refusals: Record<string, string> = {}
  for (const [damage, paths] of Object.entries(damages))
    refusals[damage] = await statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Assert
  assert.deepEqual(refusals, {
    receiptIsNoJson: sentenceOfAnInvalidRecord(
      'Cursor skill ownership receipt',
      recordPaths.receiptIsNoJson!,
      damages.receiptIsNoJson,
    ),
    displacedName: sentenceOfAnInvalidRecord(
      'Cursor skill pending displacement path',
      recordPaths.displacedName!,
      damages.displacedName,
    ),
    retainedName: sentenceOfAnInvalidRecord(
      'Cursor skill pending private retention path',
      recordPaths.retainedName!,
      damages.retainedName,
    ),
    previousOwner: sentenceOfAnInvalidRecord(
      'Cursor skill ownership receipt',
      recordPaths.previousOwner!,
      damages.previousOwner,
    ),
  })
})

/**
 * Loads the skill deployment as a window on a file system that refuses a hard link with one code, as a file system without hard links does (`EPERM` on Linux, `ENOTSUP` on macOS, `ENOSYS` where the file system has no such call).
 * @param code - The code the refused link carries.
 * @param isRefused - Which new names are refused; every one when left out.
 * @returns The window.
 */
async function skillWindowWhoseLinkIsRefused(
  code: string,
  isRefused: (newPath: string) => boolean = () => true,
): Promise<typeof CursorSkillModule> {
  return skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        if (isRefused(newPath))
          throw Object.assign(new Error(`${code}: refused, link`), { code })
        return fileSystem.link(existingPath, newPath)
      },
    },
  })
}

// Value: protects=a learner whose home folder is on a file system without hard links (exFAT, some network shares); fails_when=Cursor chat setup ends at every try with the file system's own text ("EPERM: operation not permitted, link …"), which says neither what was refused nor what the folder must allow, or leaves its staged file and its record behind; why_new=Cycle 0046 row 214; seam=node:fs/promises link of the loaded deployment, which the file system refuses
test('a first setup of the Cursor skill on a file system that refuses hard links ends with a sentence that names the path, the refusal and what the folder must allow, for EPERM, ENOTSUP and ENOSYS alike; it leaves nothing behind and changes no file of the learner', async (context) => {
  // Arrange: three home folders without a skill, each with a file of the learner beside the place of Codebook's skill folder.
  const refusals: Record<string, string> = {}
  const leftBehind: Record<string, unknown> = {}
  const expectedRefusals: Record<string, string> = {}
  for (const code of ['EPERM', 'ENOTSUP', 'ENOSYS']) {
    const paths = await fixture(context)
    const skills = join(paths.homeRoot, '.cursor', 'skills')
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, 'mine.md'), 'A skill of the learner.\n')
    const window = await skillWindowWhoseLinkIsRefused(code)

    // Act
    refusals[code] = await statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )
    leftBehind[code] = {
      ...(await filesOfTheSetup(paths)),
      learnersFile: await readFile(join(skills, 'mine.md'), 'utf8'),
    }
    expectedRefusals[code] =
      `Cursor skill could not be installed: the file system refused to put Codebook's new file in place as ${paths.targetPath} (${code}). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`
  }

  // Assert
  const nothingLeft = {
    skillFolder: [],
    temporaryNames: [],
    records: [],
    learnersFile: 'A skill of the learner.\n',
  }
  assert.deepEqual(
    { refusals, leftBehind },
    {
      refusals: expectedRefusals,
      leftBehind: {
        EPERM: nothingLeft,
        ENOTSUP: nothingLeft,
        ENOSYS: nothingLeft,
      },
    },
  )
})

// Value: protects=the installed skill of a learner whose storage folder refuses hard links when an extension update brings a new skill; fails_when=the update ends with the file system's own text, or changes the installed skill before it could keep a copy of it; why_new=Cycle 0046 row 214 (the copy setup keeps before an update is linked too); seam=node:fs/promises link of the loaded deployment, which the file system refuses
test('an update of the Cursor skill whose copy of the installed skill the file system refuses to link ends with a sentence that names the copy and the refusal, and the installed skill stays as it is', async (context) => {
  // Arrange: the installed skill; the extension brings a new one; every link is refused.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindowWhoseLinkIsRefused('EPERM')

  // Act
  const update = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      update,
      files: await filesOfTheSetup(paths),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      update: `Cursor skill could not be updated: the file system refused to keep a copy of the installed skill as ${join(paths.storageRoot, 'cursor-skill', `${createHash('sha256').update(INITIAL_SKILL).digest('hex')}.SKILL.md`)} (EPERM). No skill file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      skill: INITIAL_SKILL,
    },
  )
})

// Value: protects=Codebook's previous skill when the link of an update is refused after the previous skill was moved away; fails_when=the update ends with the file system's own text and the learner cannot tell that the skill they had is under another name, or the sentence's way back does not work; why_new=Cycle 0046 row 214: after the move no call puts the file back that could not replace another file, so the sentence says where it is; seam=node:fs/promises link of the loaded deployment, which the file system refuses for the skill's path alone
test('an update of the Cursor skill whose new skill the file system refuses to link, after the previous skill was moved away, says where the previous skill is kept, and after the learner moves it back, a setup on a file system that links updates the skill', async (context) => {
  // Arrange: the installed skill; the extension brings a new one; only the link to the skill's path is refused.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindowWhoseLinkIsRefused(
    'EPERM',
    (newPath) => newPath === paths.targetPath,
  )

  // Act: the refusal is followed to the letter.
  const update = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const [displacedName] = (await filesOfTheSetup(paths)).skillFolder
  const displacedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    displacedName ?? 'no displaced file',
  )
  const previousSkillUnderItsOtherName = await readFile(displacedPath, 'utf8')
  await rename(displacedPath, paths.targetPath)
  const setupWhereLinksWork = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      update,
      previousSkillUnderItsOtherName,
      setupWhereLinksWork,
      files: await filesOfTheSetup(paths),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      update: `Cursor skill could not be installed: the file system refused to put Codebook's new file in place as ${paths.targetPath} (EPERM). Codebook's previous skill is kept as ${displacedPath}; move it back to ${paths.targetPath} to go on using it. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      previousSkillUnderItsOtherName: INITIAL_SKILL,
      setupWhereLinksWork: 'updated',
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      skill: NEXT_SKILL,
    },
  )
})

// Value: protects=a file that appears at the skill's path in the instant before Codebook links its new skill there; fails_when=setup ends with the file system's own text ("EEXIST: file already exists, link …") and keeps its staged file and its record, so the next setup starts in an interrupted state; why_new=Cycle 0046 row 214, found while working: the link's other refusal, a file that is already there, had no sentence either; seam=node:fs/promises link of the loaded deployment, before which a file takes the skill's path
test('a file that takes the Cursor skill’s path in the instant before a first setup links its skill there is kept: setup answers that the skill changed during setup and leaves no record and no staged file, and after the learner deletes that file, setup installs the skill', async (context) => {
  // Arrange: no skill yet; a file of the learner appears at the skill's path right before the link.
  const paths = await fixture(context)
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        if (newPath === paths.targetPath)
          await writeFile(newPath, 'A file of the learner.\n')
        return fileSystem.link(existingPath, newPath)
      },
    },
  })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const files = await filesOfTheSetup(paths)
  const fileAtTheSkillPath = await readFile(paths.targetPath, 'utf8')
  // The setup's sentence is followed to the letter.
  await rm(paths.targetPath)
  const setupAfterTheFileWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { setup, files, fileAtTheSkillPath, setupAfterTheFileWasDeleted },
    {
      setup: `The Cursor skill changed during setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      fileAtTheSkillPath: 'A file of the learner.\n',
      setupAfterTheFileWasDeleted: 'installed',
    },
  )
})

// Value: protects=a learner who runs the removal where the receipt of the skill is gone, or where Cursor never had a skills folder; fails_when=the removal throws "No installed Codebook-owned Cursor skill was found; no file was changed." or refuses the missing skills folder, so the removal command never goes on to the Cursor MCP config; why_new=Cycle 0046 row 244; seam=none, the real files
test('a removal of the Cursor skill without a receipt answers that no skill of Codebook’s is installed and changes no file: after the learner deleted the receipt of an installed skill, and in a home that has no skills folder', async (context) => {
  // Arrange: one home whose receipt the learner deleted, and one where Cursor chat was never set up.
  const withoutReceipt = await fixture(context),
    neverSetUp = await fixture(context)
  await deployCursorSkill(
    withoutReceipt.extensionPath,
    withoutReceipt.storageRoot,
    withoutReceipt.homeRoot,
  )
  await rm(join(withoutReceipt.storageRoot, 'cursor-skill', 'receipt.json'))
  await mkdir(join(neverSetUp.homeRoot, '.cursor'))

  // Act
  const removals = {
    withoutReceipt: await removeManagedCursorSkill(
      withoutReceipt.storageRoot,
      withoutReceipt.homeRoot,
    ),
    neverSetUp: await removeManagedCursorSkill(
      neverSetUp.storageRoot,
      neverSetUp.homeRoot,
    ),
  }

  // Assert
  assert.deepEqual(
    {
      removals,
      skillWithoutReceipt: await readFile(withoutReceipt.targetPath, 'utf8'),
      cursorFolderNeverSetUp: await readdir(
        join(neverSetUp.homeRoot, '.cursor'),
      ),
    },
    {
      removals: {
        withoutReceipt: {
          status: 'not-installed',
          path: withoutReceipt.targetPath,
        },
        neverSetUp: { status: 'not-installed', path: neverSetUp.targetPath },
      },
      skillWithoutReceipt: INITIAL_SKILL,
      cursorFolderNeverSetUp: [],
    },
  )
})

// Value: protects=a learner whose editor saves the skill file right before the removal moves it, while another file takes the skill's path before Codebook can put the edit back; fails_when=the refusal that keeps the removal's record says "then run Codebook: Set Up AI Chat again" to a learner who ran the removal; why_new=Cycle 0046 row 244: the removal's own kept-record sentence names the removal; seam=node:fs/promises rename of the loaded deployment, before whose move the skill file is edited and after whose move another file takes its path
test('a removal whose skill file was edited before its move, and whose path another file took before the edit could be put back, keeps both files and its record and names the removal as the command to run again', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      rename: async (from: string, to: string) => {
        if (from !== paths.targetPath) return fileSystem.rename(from, to)
        await writeFile(from, EDITED_SKILL)
        await fileSystem.rename(from, to)
        await writeFile(from, 'A newer file of the learner.\n')
      },
    },
  })

  // Act
  const refusal = await statusOrRefusalOf(
    window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )

  // Assert
  const skillFolder = join(paths.homeRoot, '.cursor', 'skills', 'codebook')
  const displacedName = (await readdir(skillFolder)).find((name) =>
    name.startsWith('.codebook-displaced-'),
  )
  assert.ok(displacedName)
  assert.deepEqual(
    {
      refusal,
      displaced: await readFile(join(skillFolder, displacedName), 'utf8'),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      refusal: `Cursor skill changed during interrupted removal: ${paths.targetPath}. Codebook preserved it and the displaced file (${join(skillFolder, displacedName)}). To start over, delete ${join(paths.storageRoot, 'cursor-skill', 'removal.json')}, then run Codebook: Remove Managed Cursor Skill again.`,
      displaced: EDITED_SKILL,
      skill: 'A newer file of the learner.\n',
    },
  )
})

/**
 * Loads the skill deployment as a window on a file system that gives the inode number of a deleted file to the next file it creates (ext4 does so at once): right before a setup moves the skill away, the skill is deleted and another file is created at its path, and every look of the window reports that file under the deleted skill's number, whatever number this system gave it.
 * @param skillPath - The managed skill path, which holds the installed skill.
 * @param textOfTheNewFile - What the file that takes the path holds.
 * @returns The window; its replacement happens once, at the first move of the skill.
 */
async function skillWindowWhoseNewFileGetsTheFreedNumber(
  skillPath: string,
  textOfTheNewFile: string,
): Promise<typeof CursorSkillModule> {
  const freedNumber = (await lstat(skillPath, { bigint: true })).ino
  let isSkillReplaced = false
  let numberOfTheNewFile: bigint | undefined
  /** Reports the new file under the freed number, in the form the look asked for (a number or a bigint). */
  const renumbered = <Status extends { ino: number | bigint }>(
    status: Status,
  ): Status =>
    BigInt(status.ino) === numberOfTheNewFile
      ? Object.assign(Object.create(Object.getPrototypeOf(status)), status, {
          ino:
            typeof status.ino === 'bigint' ? freedNumber : Number(freedNumber),
        })
      : status
  return skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string, options?: StatOptions) =>
        renumbered(await fileSystem.lstat(path, options)),
      rename: async (from: string, to: string) => {
        if (from === skillPath && !isSkillReplaced) {
          isSkillReplaced = true
          await rm(from)
          await writeFile(from, textOfTheNewFile)
          numberOfTheNewFile = (await lstat(from, { bigint: true })).ino
        }
        return fileSystem.rename(from, to)
      },
    },
    './utils/openWithoutFollowing': {
      openWithoutFollowing: async (
        path: string,
      ): Promise<fileSystem.FileHandle> => {
        const file = await openWithoutFollowing(path)
        const statusOf = file.stat.bind(file)
        return Object.assign(file, {
          stat: async (options?: StatOptions) =>
            renumbered(await statusOf(options)),
        })
      },
    },
  })
}

// Value: protects=the learner whose file takes the skill's path after the skill was deleted, on a file system that gives the new file the deleted skill's inode number (the hosted Linux runner's did, run 37577541299); fails_when=the step the sentence names for a skill "edited" in place does not work for such a file: after the learner renames it setup does not finish, or after the learner puts the installed text into it setup refuses it; why_new=Cycle 0046 row 291: Codebook tells "another file" from "edited in place" by the inode number, so this file reads as edited, and the sentence must serve it too; seam=node:fs/promises lstat and rename and the opener of the loaded deployment, which report the new file under the deleted skill's number
test('a file that is created at the skill’s path right after the skill was deleted, on a file system that gives it the deleted skill’s inode number, is answered by setup as the skill edited in place, and both ways its sentence names end in a finished setup: after the learner renames the file, setup restores the skill; after the learner puts the installed text into it, setup updates the skill', async (context) => {
  // Arrange: two installed skills whose extension brings a new one; in each window the skill is deleted and a file of the learner is created at its path right before setup moves the skill.
  const homeThatRenames = await fixture(context),
    homeThatUndoes = await fixture(context)
  for (const paths of [homeThatRenames, homeThatUndoes]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.sourcePath, NEXT_SKILL)
  }
  const windowThatRenames = await skillWindowWhoseNewFileGetsTheFreedNumber(
      homeThatRenames.targetPath,
      'A file of the learner.\n',
    ),
    windowThatUndoes = await skillWindowWhoseNewFileGetsTheFreedNumber(
      homeThatUndoes.targetPath,
      'A file of the learner.\n',
    )
  const setUpIn = (
    window: typeof CursorSkillModule,
    paths: typeof homeThatRenames,
  ): Promise<string> =>
    statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )

  // Act: the setup during which the file appears, the next setup, and then the sentence to the letter, one way in each home.
  const setups = {
    renames: await setUpIn(windowThatRenames, homeThatRenames),
    undoes: await setUpIn(windowThatUndoes, homeThatUndoes),
  }
  const filesAfterTheSetups = {
    renames: await filesOfTheSetup(homeThatRenames),
    undoes: await filesOfTheSetup(homeThatUndoes),
  }
  const nextSetups = {
    renames: await setUpIn(windowThatRenames, homeThatRenames),
    undoes: await setUpIn(windowThatUndoes, homeThatUndoes),
  }
  await rename(
    homeThatRenames.targetPath,
    join(homeThatRenames.homeRoot, '.cursor', 'skills', 'codebook', 'MINE.md'),
  )
  await writeFile(homeThatUndoes.targetPath, INITIAL_SKILL)
  const setupsAfterTheStep = {
    renames: await setUpIn(windowThatRenames, homeThatRenames),
    undoes: await setUpIn(windowThatUndoes, homeThatUndoes),
  }

  // Assert
  assert.deepEqual(
    {
      setups,
      filesAfterTheSetups,
      nextSetups,
      setupsAfterTheStep,
      skills: {
        renames: await readFile(homeThatRenames.targetPath, 'utf8'),
        undoes: await readFile(homeThatUndoes.targetPath, 'utf8'),
      },
      renamedFile: await readFile(
        join(
          homeThatRenames.homeRoot,
          '.cursor',
          'skills',
          'codebook',
          'MINE.md',
        ),
        'utf8',
      ),
    },
    {
      setups: {
        renames: `The Cursor skill was edited during setup: ${homeThatRenames.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
        undoes: `The Cursor skill was edited during setup: ${homeThatUndoes.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      },
      filesAfterTheSetups: {
        renames: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
        undoes: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      },
      nextSetups: {
        renames: `The managed Cursor skill was edited after setup: ${homeThatRenames.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
        undoes: `The managed Cursor skill was edited after setup: ${homeThatUndoes.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      },
      setupsAfterTheStep: { renames: 'restored', undoes: 'updated' },
      skills: { renames: NEXT_SKILL, undoes: NEXT_SKILL },
      renamedFile: 'A file of the learner.\n',
    },
  )
})

// Value: protects=a learner whose installed Cursor skill is replaced by another file, or taken away, while an update of it runs; fails_when=setup says "Restore or remove that change", a step after which no setup adopts a replaced file, or speaks of a preserved file where none is left; why_new=Cycle 0046 row 242: each sentence names the step that works for what stands at the skill's path; seam=node:fs/promises of the loaded deployment: its rename, before whose move another file replaces the skill, and its lstat, at whose look at the staged file the skill is deleted
test('an installed Cursor skill that another file replaces, or that is taken away, while its update runs: setup says for each what to do, and after the learner moves the other file out of the folder, or simply runs setup again, setup installs the skill', async (context) => {
  // Arrange: two installed skills whose extension brings a new one. One is replaced by a file of the learner right before setup moves it; the other is deleted when setup looks at the file it staged.
  const replaced = await fixture(context),
    removed = await fixture(context)
  for (const paths of [replaced, removed]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.sourcePath, NEXT_SKILL)
  }
  const windowOfTheReplacement = await skillWindow(
    constants.EXTENSION_VERSION,
    {
      'node:fs/promises': {
        ...fileSystem,
        rename: async (from: string, to: string) => {
          if (from === replaced.targetPath) {
            // The file replaces the skill as an editor saves: written beside the path and moved over it. Both files exist at one moment, so they have two inode numbers on every file system; a file created after the skill was deleted can get the skill's number again (row 291).
            const besideThePath = join(replaced.homeRoot, 'replacement.md')
            await writeFile(besideThePath, 'A file of the learner.\n')
            await fileSystem.rename(besideThePath, from)
          }
          return fileSystem.rename(from, to)
        },
      },
    },
  )
  let isSkillRemoved = false
  const windowOfTheRemoval = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string, options?: StatOptions) => {
        if (path.includes('.codebook-stage-') && !isSkillRemoved) {
          isSkillRemoved = true
          await rm(removed.targetPath)
        }
        return fileSystem.lstat(path, options)
      },
    },
  })

  // Act: each refusal, and then its sentence followed to the letter.
  const setupOfTheReplaced = await statusOrRefusalOf(
    windowOfTheReplacement.deployCursorSkill(
      replaced.extensionPath,
      replaced.storageRoot,
      replaced.homeRoot,
    ),
  )
  const filesOfTheReplaced = await filesOfTheSetup(replaced)
  const fileOfTheLearner = await readFile(replaced.targetPath, 'utf8')
  await rename(replaced.targetPath, join(replaced.homeRoot, 'my-SKILL.md'))
  const setupAfterTheFileWasMovedOut = await statusOrRefusalOf(
    deployCursorSkill(
      replaced.extensionPath,
      replaced.storageRoot,
      replaced.homeRoot,
    ),
  )
  const setupOfTheRemoved = await statusOrRefusalOf(
    windowOfTheRemoval.deployCursorSkill(
      removed.extensionPath,
      removed.storageRoot,
      removed.homeRoot,
    ),
  )
  const filesOfTheRemoved = await filesOfTheSetup(removed)
  const setupRunAgain = await statusOrRefusalOf(
    deployCursorSkill(
      removed.extensionPath,
      removed.storageRoot,
      removed.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      setupOfTheReplaced,
      filesOfTheReplaced,
      fileOfTheLearner,
      setupAfterTheFileWasMovedOut,
      setupOfTheRemoved,
      filesOfTheRemoved,
      setupRunAgain,
    },
    {
      setupOfTheReplaced: `The Cursor skill changed during setup: ${replaced.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again.`,
      filesOfTheReplaced: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      fileOfTheLearner: 'A file of the learner.\n',
      setupAfterTheFileWasMovedOut: 'restored',
      setupOfTheRemoved: `The Cursor skill was removed while setup ran: ${removed.targetPath}. Codebook changed no file. Run Codebook: Set Up AI Chat again to install it.`,
      filesOfTheRemoved: { skillFolder: [], temporaryNames: [], records: [] },
      setupRunAgain: 'restored',
    },
  )
})

// Value: protects=a learner whose editor saves the skill file right after an update published the new skill; fails_when=setup says "Restore or remove that change", although the receipt names the previous skill and no setup adopts the edited file again; why_new=Cycle 0046 row 242 (the update's case of the published skill); seam=node:fs/promises link of the loaded deployment, after whose link into place the skill file is written
test('a Cursor skill that is edited right after an update published it is kept: setup says to delete it or to move it out of its folder, and after the learner deletes it, setup installs the skill again', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await fileSystem.link(existingPath, newPath)
        if (newPath === paths.targetPath) await writeFile(newPath, EDITED_SKILL)
      },
    },
  })

  // Act: the refusal, and then its sentence followed to the letter.
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  const skillAfterTheRefusal = await readFile(paths.targetPath, 'utf8')
  await rm(paths.targetPath)
  const setupAfterTheFileWasDeleted = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      skillAfterTheRefusal,
      setupAfterTheFileWasDeleted,
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The published Cursor skill changed during setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      skillAfterTheRefusal: EDITED_SKILL,
      setupAfterTheFileWasDeleted: 'restored',
      skill: NEXT_SKILL,
    },
  )
})

// Value: protects=a learner whose editor saves the installed skill while setup keeps a copy of it, before anything is staged or moved; fails_when=setup ends with "The Cursor skill changed during setup; no replacement was made.", which names no next step; why_new=Cycle 0046 row 242 (found beside it): that moment is answered by the check before the move, with the sentence of an edit; seam=node:fs/promises link of the loaded deployment, at whose link of the copy the skill file is written
test('a Cursor skill that is edited while setup keeps a copy of the installed skill is kept: setup says to undo the edit or to delete or rename the file, and leaves no record and no staged file', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        if (newPath.endsWith('.SKILL.md'))
          await writeFile(paths.targetPath, EDITED_SKILL)
        return fileSystem.link(existingPath, newPath)
      },
    },
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
      files: await filesOfTheSetup(paths),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The Cursor skill was edited during setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=a learner on a file system that refuses hard links whose update was refused and who runs setup again without moving the previous skill back; fails_when=the second setup ends at the recovery's own link with the file system's text ("EPERM: operation not permitted, link …"), at every try, and no longer says where the previous skill is; why_new=Cycle 0046 row 243: row 214 closed the first try only; seam=node:fs/promises link of the loaded deployment, which refuses the link to the skill's path with EPERM
test('a second and a third setup of the Cursor skill on a file system that still refuses hard links, after an update moved the previous skill away, end with the same sentence that names where the previous skill is kept; after the learner moves it back, a setup on a file system that links updates the skill', async (context) => {
  // Arrange: the installed skill; the extension brings a new one; the link to the skill's path is refused.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindowWhoseLinkIsRefused(
    'EPERM',
    (newPath) => newPath === paths.targetPath,
  )
  const setUpOnThatFileSystem = (): Promise<string> =>
    statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )

  // Act: three setups without the move back, then the sentence followed to the letter.
  const firstSetup = await setUpOnThatFileSystem()
  const [displacedName] = (await filesOfTheSetup(paths)).skillFolder
  const displacedPath = join(
    paths.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    displacedName ?? 'no displaced file',
  )
  const secondSetup = await setUpOnThatFileSystem()
  const thirdSetup = await setUpOnThatFileSystem()
  const filesAfterTheThirdSetup = await filesOfTheSetup(paths)
  const previousSkillUnderItsOtherName = await readFile(displacedPath, 'utf8')
  await rename(displacedPath, paths.targetPath)
  const setupWhereLinksWork = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  const refusal = `Cursor skill could not be installed: the file system refused to put Codebook's new file in place as ${paths.targetPath} (EPERM). Codebook's previous skill is kept as ${displacedPath}; move it back to ${paths.targetPath} to go on using it. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`
  assert.deepEqual(
    {
      firstSetup,
      secondSetup,
      thirdSetup,
      filesAfterTheThirdSetup,
      previousSkillUnderItsOtherName,
      setupWhereLinksWork,
      files: await filesOfTheSetup(paths),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      firstSetup: refusal,
      secondSetup: refusal,
      thirdSetup: refusal,
      // The first setup's record and no second one; its staged file, which the record proved, went at the second try.
      filesAfterTheThirdSetup: {
        skillFolder: [displacedName],
        temporaryNames: [],
        records: ['pending.json'],
      },
      previousSkillUnderItsOtherName: INITIAL_SKILL,
      setupWhereLinksWork: 'updated',
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      skill: NEXT_SKILL,
    },
  )
})

// Value: protects=a file that takes the skill's path in the instant before a setup's recovery links the previous skill back; fails_when=the recovery ends with the file system's text ("EEXIST: file already exists, link …") and keeps the record, so every setup ends the same way; why_new=Cycle 0046 row 243: the recovery's link answers every code; seam=node:fs/promises link of the loaded deployment, before whose link to the skill's path a file of the learner appears there
test('a file that takes the Cursor skill’s path right before a setup puts the previous skill of an interrupted update back is kept: the previous skill is retained in Codebook’s storage, no record is left, and setup answers as for a replaced skill', async (context) => {
  // Arrange: an update that stopped after it moved the installed skill away.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const record = await writeUpdateRecord(paths)
  await rename(paths.targetPath, record.displacedPath)
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        if (newPath === paths.targetPath)
          await writeFile(newPath, 'A file of the learner.\n')
        return fileSystem.link(existingPath, newPath)
      },
    },
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
      files: await filesOfTheSetup(paths),
      fileAtTheSkillPath: await readFile(paths.targetPath, 'utf8'),
      retainedPreviousSkill: await readFile(
        join(
          paths.storageRoot,
          'cursor-skill',
          'retired-00000000-0000-0000-0000-000000000188.SKILL.md',
        ),
        'utf8',
      ),
    },
    {
      setup: `The managed Cursor skill was replaced after setup: ${paths.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      fileAtTheSkillPath: 'A file of the learner.\n',
      retainedPreviousSkill: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner on a file system that refuses hard links whose skill file is edited in the instant before a setup or a removal moves it away; fails_when=Codebook cannot put the edit back and ends with the file system's text ("EPERM: operation not permitted, link …"), which does not say that the learner's file now stands under another name; why_new=Cycle 0046 row 243: the link back of a changed file answers with a sentence that names the kept file; seam=node:fs/promises rename of the loaded deployment, before whose move the skill is edited, and its utility for the link back loaded over a file system that refuses links with EPERM
test('a Cursor skill that is edited right before a setup or a removal moves it, on a file system that refuses to link it back, is kept under its displaced name: each try says where the file is and names the command that was run, and after the learner moves it back, setup and removal answer for the edit and leave no record', async (context) => {
  // Arrange: two installed skills, one for the setup of an update and one for the removal.
  const forSetup = await fixture(context),
    forRemoval = await fixture(context)
  for (const paths of [forSetup, forRemoval])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  await writeFile(forSetup.sourcePath, NEXT_SKILL)
  const windowOf = async (
    skillPath: string,
  ): Promise<typeof CursorSkillModule> =>
    skillWindow(constants.EXTENSION_VERSION, {
      'node:fs/promises': {
        ...fileSystem,
        rename: async (from: string, to: string) => {
          if (from === skillPath) await writeFile(from, EDITED_SKILL)
          return fileSystem.rename(from, to)
        },
      },
      './utils/dropSecondNameOfMovedFile':
        await loadDropSecondNameWhoseLinkIsRefused('EPERM'),
    })
  const setupWindow = await windowOf(forSetup.targetPath),
    removalWindow = await windowOf(forRemoval.targetPath)
  const setUp = (): Promise<string> =>
    statusOrRefusalOf(
      setupWindow.deployCursorSkill(
        forSetup.extensionPath,
        forSetup.storageRoot,
        forSetup.homeRoot,
      ),
    )
  const remove = (): Promise<string> =>
    statusOrRefusalOf(
      removalWindow.removeManagedCursorSkill(
        forRemoval.storageRoot,
        forRemoval.homeRoot,
      ),
    )
  const displacedPathOf = async (paths: {
    homeRoot: string
    storageRoot: string
  }): Promise<string> =>
    join(
      paths.homeRoot,
      '.cursor',
      'skills',
      'codebook',
      (await filesOfTheSetup(paths)).skillFolder[0] ?? 'no displaced file',
    )

  // Act: two tries each, then each sentence followed to the letter on a file system that links.
  const firstSetup = await setUp()
  const displacedOfTheSetup = await displacedPathOf(forSetup)
  const secondSetup = await setUp()
  await rename(displacedOfTheSetup, forSetup.targetPath)
  const setupAfterTheMoveBack = await statusOrRefusalOf(
    deployCursorSkill(
      forSetup.extensionPath,
      forSetup.storageRoot,
      forSetup.homeRoot,
    ),
  )
  const firstRemoval = await remove()
  const displacedOfTheRemoval = await displacedPathOf(forRemoval)
  const secondRemoval = await remove()
  await rename(displacedOfTheRemoval, forRemoval.targetPath)
  const removalAfterTheMoveBack = await statusOrRefusalOf(
    removeManagedCursorSkill(forRemoval.storageRoot, forRemoval.homeRoot),
  )

  // Assert
  const refusalOfTheSetup = `The Cursor skill changed while Codebook had moved it away, and the file system refused to put it back as ${forSetup.targetPath} (EPERM). The file is kept as ${displacedOfTheSetup}; move it back to ${forSetup.targetPath}, then run Codebook: Set Up AI Chat again.`
  const refusalOfTheRemoval = `The Cursor skill changed while Codebook had moved it away, and the file system refused to put it back as ${forRemoval.targetPath} (EPERM). The file is kept as ${displacedOfTheRemoval}; move it back to ${forRemoval.targetPath}, then run Codebook: Remove Managed Cursor Skill again.`
  assert.deepEqual(
    {
      firstSetup,
      secondSetup,
      setupAfterTheMoveBack,
      filesOfTheSetup: await filesOfTheSetup(forSetup),
      skillOfTheSetup: await readFile(forSetup.targetPath, 'utf8'),
      firstRemoval,
      secondRemoval,
      removalAfterTheMoveBack,
      filesOfTheRemoval: await filesOfTheSetup(forRemoval),
      skillOfTheRemoval: await readFile(forRemoval.targetPath, 'utf8'),
    },
    {
      firstSetup: refusalOfTheSetup,
      secondSetup: refusalOfTheSetup,
      setupAfterTheMoveBack: `The managed Cursor skill was edited after setup: ${forSetup.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      filesOfTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      skillOfTheSetup: EDITED_SKILL,
      firstRemoval: refusalOfTheRemoval,
      secondRemoval: refusalOfTheRemoval,
      removalAfterTheMoveBack: `The Cursor skill was edited after setup: ${forRemoval.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
      filesOfTheRemoval: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      skillOfTheRemoval: EDITED_SKILL,
    },
  )
})

// Value: protects=the learner's skills folder after a setup that was killed between staging its new skill and writing its record, or whose record the learner deleted; fails_when=the staged file stays in ~/.cursor/skills for good, because only a record leads a setup to it, or a setup removes a file under such a name that is not provably Codebook's; why_new=Cycle 0046 row 247: a setup removes staged files no record names when they hold the bundled skill or are a second name of the installed skill; seam=none, the real files
test('a setup removes the staged files of earlier setups that no record names when they hold the bundled skill or are a second name of the file at the skill’s path, and leaves a file under such a name that holds other bytes', async (context) => {
  // Arrange: the installed skill, which the learner edited since, and three files under staged names: the bundled skill as a killed setup staged it, a second name of the skill file, and a file with bytes of the learner.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.targetPath, EDITED_SKILL)
  const stagedName = (suffix: string): string =>
    join(
      paths.homeRoot,
      '.cursor',
      'skills',
      `.codebook-stage-00000000-0000-0000-0000-00000000024${suffix}.tmp`,
    )
  await writeFile(stagedName('1'), INITIAL_SKILL)
  await fileSystem.link(paths.targetPath, stagedName('2'))
  await writeFile(stagedName('3'), 'Bytes of the learner.\n')

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      files: await filesOfTheSetup(paths),
      keptFile: await readFile(stagedName('3'), 'utf8'),
      skill: await readFile(paths.targetPath, 'utf8'),
    },
    {
      setup: `The managed Cursor skill was edited after setup: ${paths.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      files: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [
          '.codebook-stage-00000000-0000-0000-0000-000000000243.tmp',
        ],
        records: [],
      },
      keptFile: 'Bytes of the learner.\n',
      skill: EDITED_SKILL,
    },
  )
})

// Value: protects=bytes somebody wrote into the file a setup staged, when that setup's record must stay; fails_when=the refusal's way out deletes the record and names nothing else, so the changed file under the staged name is left without any sentence that names it, or Codebook deletes it although the record no longer proves it; why_new=Cycle 0046 row 247: a staged file that cannot be proven Codebook's is named in the way out; seam=none, the files as the state leaves them
test('a refusal that keeps a setup’s record of the Cursor skill names what stands under the staged name when that is not the file Codebook wrote, and leaves it there', async (context) => {
  // Arrange: an update that was interrupted after it moved the installed skill away, whose retained name is taken; the staged file was overwritten since.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const record = await writeUpdateRecord(paths)
  const retainedPath = join(
    paths.storageRoot,
    'cursor-skill',
    'retired-00000000-0000-0000-0000-000000000188.SKILL.md',
  )
  await writeFile(retainedPath, 'Another file.\n')
  await writeFile(record.stagedPath, 'Bytes somebody wrote.\n')
  await writeFile(record.displacedPath, 'A foreign file.\n')

  // Act
  const setup = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { setup, stagedFile: await readFile(record.stagedPath, 'utf8') },
    {
      setup: `Cursor skill displacement and private retention both exist; Codebook preserved both for inspection: ${record.displacedPath} and ${retainedPath}. To start over, delete ${record.pendingPath}, then run Codebook: Set Up AI Chat again. What stands under the staged name ${record.stagedPath} is not the file Codebook wrote there; Codebook left it, so look at it before you delete it.`,
      stagedFile: 'Bytes somebody wrote.\n',
    },
  )
})

// Value: protects=the skills folder of a learner whose changed skill file Codebook could not put back because another file took the skill's path; fails_when=the refusal keeps the setup's record and its way out deletes that record, while the staged file, which only the record named, stays in ~/.cursor/skills for good; why_new=Cycle 0046 row 247: the staged file the record proves goes before a refusal that keeps the record; seam=node:fs/promises rename of the loaded deployment, before whose move the skill is edited and after whose move another file takes its path; and for the recovery the files as the state leaves them
test('a setup that keeps its record because another file took the skill’s path leaves no staged file behind, in the setup that moved the edited skill away and in the recovery of a published skill that was edited', async (context) => {
  // Arrange: two installed skills whose extension brings a new one. First: the skill is edited right before the setup moves it, and another file takes its path right after. Second: an interrupted update that published the new skill, which was edited in place since, with a foreign file under the displaced name.
  const duringSetup = await fixture(context),
    duringRecovery = await fixture(context)
  for (const paths of [duringSetup, duringRecovery]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.sourcePath, NEXT_SKILL)
  }
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      rename: async (from: string, to: string) => {
        if (from !== duringSetup.targetPath) return fileSystem.rename(from, to)
        await writeFile(from, EDITED_SKILL)
        await fileSystem.rename(from, to)
        await writeFile(from, 'A newer file of the learner.\n')
      },
    },
  })
  const record = await writeUpdateRecord(duringRecovery)
  await rm(duringRecovery.targetPath)
  await fileSystem.link(record.stagedPath, duringRecovery.targetPath)
  await writeFile(duringRecovery.targetPath, EDITED_SKILL)
  await writeFile(record.displacedPath, 'A foreign file.\n')

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      duringSetup.extensionPath,
      duringSetup.storageRoot,
      duringSetup.homeRoot,
    ),
  )
  const recovery = await statusOrRefusalOf(
    deployCursorSkill(
      duringRecovery.extensionPath,
      duringRecovery.storageRoot,
      duringRecovery.homeRoot,
    ),
  )

  // Assert
  const filesOfTheSetupThatMoved = await filesOfTheSetup(duringSetup)
  const displacedOfTheSetup = join(
    duringSetup.homeRoot,
    '.cursor',
    'skills',
    'codebook',
    filesOfTheSetupThatMoved.skillFolder[0] ?? 'no displaced file',
  )
  assert.deepEqual(
    {
      setup,
      stagedFilesOfTheSetup: filesOfTheSetupThatMoved.temporaryNames,
      recovery,
      stagedFilesOfTheRecovery: (await filesOfTheSetup(duringRecovery))
        .temporaryNames,
      editedSkillOfTheRecovery: await readFile(
        duringRecovery.targetPath,
        'utf8',
      ),
    },
    {
      setup: `Cursor skill changed during an interrupted setup: ${duringSetup.targetPath}. Codebook preserved it and its recovery record. The file Codebook had moved away is kept as ${displacedOfTheSetup}. To start over, delete ${join(duringSetup.storageRoot, 'cursor-skill', 'pending.json')}, then run Codebook: Set Up AI Chat again.`,
      stagedFilesOfTheSetup: [],
      recovery: `Cursor skill changed during an interrupted setup: ${duringRecovery.targetPath}. Codebook preserved it and its recovery record. The file Codebook had moved away is kept as ${record.displacedPath}. To start over, delete ${record.pendingPath}, then run Codebook: Set Up AI Chat again.`,
      stagedFilesOfTheRecovery: [],
      editedSkillOfTheRecovery: EDITED_SKILL,
    },
  )
})

// Value: protects=a learner who moved the skill file a removal had retained back to the skill's path, and one whose copy of the installed skill in Codebook's storage was damaged; fails_when=setup answers "A codebook skill appeared after managed removal; Codebook preserved it." or "The previous managed skill backup differs from its receipt; no replacement was made.", which name no next step, at every try; why_new=Cycle 0046, found beside rows 242 and 247: both sentences say what to do, and the step ends in a finished setup; seam=none, the real files
test('setup says what to do about a skill file that is back after a removal, and about a damaged copy of the installed skill in its storage: after the learner deletes the file, setup restores the skill, and after the learner deletes the copy, setup updates it', async (context) => {
  // Arrange: one skill that was removed and whose retained file the learner moved back; one installed skill whose extension brings a new one, with other bytes under the name of its copy.
  const movedBack = await fixture(context),
    damagedCopy = await fixture(context)
  for (const paths of [movedBack, damagedCopy])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  await removeManagedCursorSkill(movedBack.storageRoot, movedBack.homeRoot)
  const storageOfTheRemoved = join(movedBack.storageRoot, 'cursor-skill')
  const retainedName = (await readdir(storageOfTheRemoved)).find((name) =>
    name.startsWith('retired-'),
  )
  await mkdir(join(movedBack.homeRoot, '.cursor', 'skills', 'codebook'))
  await rename(
    join(storageOfTheRemoved, retainedName ?? 'no retained file'),
    movedBack.targetPath,
  )
  await writeFile(damagedCopy.sourcePath, NEXT_SKILL)
  const copyPath = join(
    damagedCopy.storageRoot,
    'cursor-skill',
    `${createHash('sha256').update(INITIAL_SKILL).digest('hex')}.SKILL.md`,
  )
  await writeFile(copyPath, 'Other bytes.\n')
  const setUp = (paths: typeof movedBack): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Act: each refusal, and then its sentence followed to the letter.
  const setupOfTheMovedBack = await setUp(movedBack)
  await rm(movedBack.targetPath)
  const setupAfterTheFileWasDeleted = await setUp(movedBack)
  const setupOfTheDamagedCopy = await setUp(damagedCopy)
  const skillAfterTheRefusal = await readFile(damagedCopy.targetPath, 'utf8')
  await rm(copyPath)
  const setupAfterTheCopyWasDeleted = await setUp(damagedCopy)

  // Assert
  assert.deepEqual(
    {
      setupOfTheMovedBack,
      setupAfterTheFileWasDeleted,
      setupOfTheDamagedCopy,
      skillAfterTheRefusal,
      setupAfterTheCopyWasDeleted,
    },
    {
      setupOfTheMovedBack: `A codebook skill appeared after managed removal: ${movedBack.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again.`,
      setupAfterTheFileWasDeleted: 'restored',
      setupOfTheDamagedCopy: `The copy of the installed Cursor skill that Codebook keeps as ${copyPath} differs from its receipt; no skill file was changed. Delete that copy, then run Codebook: Set Up AI Chat again.`,
      skillAfterTheRefusal: INITIAL_SKILL,
      setupAfterTheCopyWasDeleted: 'updated',
    },
  )
})

// Value: protects=a learner whose ~/.cursor/skills is a link (a dotfiles manager keeps the skills elsewhere), at setup, at editor start and at removal; fails_when=the three refusals name the path and no step ("Codebook will not follow a missing or redirected skill directory: …"), or the step they name does not end in a finished setup and a finished removal; why_new=Cycle 0046 row 277; seam=none, the real link
test('a link at ~/.cursor/skills is refused by setup, reconnect and removal with a sentence that says what to do and names the command to run again: after the learner puts the folder in the link’s place, setup finds the skill current and the removal removes it', async (context) => {
  // Arrange: the installed skill; then the skills folder is kept elsewhere and a link stands in its place.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const skillsPath = join(paths.homeRoot, '.cursor', 'skills'),
    keptSkillsPath = join(paths.homeRoot, 'dotfiles-cursor-skills')
  await rename(skillsPath, keptSkillsPath)
  if (!(await createLinkIfAllowed(keptSkillsPath, skillsPath)))
    return context.skip(LINK_NOT_ALLOWED)

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
  }
  const skillBehindTheLinkAfterTheRefusals = await readFile(
    join(keptSkillsPath, 'codebook', 'SKILL.md'),
    'utf8',
  )
  // The sentences are followed to the letter: the folder the link points to takes the link's place.
  await unlink(skillsPath)
  await rename(keptSkillsPath, skillsPath)
  const afterTheFolderTookTheLinksPlace = {
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
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      skillBehindTheLinkAfterTheRefusals,
      afterTheFolderTookTheLinksPlace,
      skillsFolderAfterTheRemoval: await readdir(skillsPath),
    },
    {
      refusals: {
        setup: `Codebook will not follow a non-directory skill path: ${skillsPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.`,
        reconnect: `Codebook will not follow a missing or redirected skill directory: ${skillsPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not follow a missing or redirected skill directory: ${skillsPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      skillBehindTheLinkAfterTheRefusals: INITIAL_SKILL,
      afterTheFolderTookTheLinksPlace: {
        setup: 'current',
        reconnect: 'current',
        removal: 'removed',
      },
      skillsFolderAfterTheRemoval: [],
    },
  )
})

// Value: protects=the learner who takes the other way a refused link at ~/.cursor/skills offers and removes the link; fails_when=that way does not end in a finished setup or removal (setup does not make the folder, or the removal refuses the missing folder), or Codebook changes something in the folder the link pointed to; why_new=Cycle 0046 row 277: each step a sentence names is followed to a finished command; seam=none, the real link
test('after the learner removes a link at ~/.cursor/skills, as its refusal offers, setup makes the folder and restores the skill, a removal finishes, and what the link pointed to stays as it is', async (context) => {
  // Arrange: two homes with an installed skill whose skills folder is kept elsewhere behind a link.
  const homeOfTheSetup = await fixture(context),
    homeOfTheRemoval = await fixture(context)
  for (const paths of [homeOfTheSetup, homeOfTheRemoval]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    const skillsPath = join(paths.homeRoot, '.cursor', 'skills')
    await rename(skillsPath, join(paths.homeRoot, 'dotfiles-cursor-skills'))
    if (
      !(await createLinkIfAllowed(
        join(paths.homeRoot, 'dotfiles-cursor-skills'),
        skillsPath,
      ))
    )
      return context.skip(LINK_NOT_ALLOWED)
  }

  // Act: the link is removed, and the command that was refused is run again.
  await unlink(join(homeOfTheSetup.homeRoot, '.cursor', 'skills'))
  const setup = await statusOrRefusalOf(
    deployCursorSkill(
      homeOfTheSetup.extensionPath,
      homeOfTheSetup.storageRoot,
      homeOfTheSetup.homeRoot,
    ),
  )
  await unlink(join(homeOfTheRemoval.homeRoot, '.cursor', 'skills'))
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(
      homeOfTheRemoval.storageRoot,
      homeOfTheRemoval.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      skillAfterTheSetup: await readFile(homeOfTheSetup.targetPath, 'utf8'),
      skillTheLinkPointedToAfterTheSetup: await readFile(
        join(
          homeOfTheSetup.homeRoot,
          'dotfiles-cursor-skills',
          'codebook',
          'SKILL.md',
        ),
        'utf8',
      ),
      removal,
      cursorFolderAfterTheRemoval: await readdir(
        join(homeOfTheRemoval.homeRoot, '.cursor'),
      ),
      skillTheLinkPointedToAfterTheRemoval: await readFile(
        join(
          homeOfTheRemoval.homeRoot,
          'dotfiles-cursor-skills',
          'codebook',
          'SKILL.md',
        ),
        'utf8',
      ),
    },
    {
      setup: 'restored',
      skillAfterTheSetup: INITIAL_SKILL,
      skillTheLinkPointedToAfterTheSetup: INITIAL_SKILL,
      removal: 'removed',
      cursorFolderAfterTheRemoval: [],
      skillTheLinkPointedToAfterTheRemoval: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner whose whole ~/.cursor is a link; fails_when=setup, reconnect and removal end with a sentence that names the path and no step, or the step does not end in a finished setup and removal; why_new=Cycle 0046 row 277 (the upper of the two folders above the skill folder); seam=none, the real link
test('a link at ~/.cursor is refused by setup, reconnect and removal with a sentence that says what to do and names the command to run again: after the learner puts the folder in the link’s place, setup finds the skill current and the removal removes it', async (context) => {
  // Arrange: the installed skill; then Cursor's settings folder is kept elsewhere and a link stands in its place.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const cursorPath = join(paths.homeRoot, '.cursor'),
    keptCursorPath = join(paths.homeRoot, 'dotfiles-cursor')
  await rename(cursorPath, keptCursorPath)
  if (!(await createLinkIfAllowed(keptCursorPath, cursorPath)))
    return context.skip(LINK_NOT_ALLOWED)

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
  }
  // The sentences are followed to the letter: the folder the link points to takes the link's place.
  await unlink(cursorPath)
  await rename(keptCursorPath, cursorPath)
  const afterTheFolderTookTheLinksPlace = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    ),
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    ),
  }

  // Assert
  assert.deepEqual(
    { refusals, afterTheFolderTookTheLinksPlace },
    {
      refusals: {
        setup: `Codebook will not follow a non-directory skill path: ${cursorPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.`,
        reconnect: `Codebook will not follow a missing or redirected skill directory: ${cursorPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not follow a missing or redirected skill directory: ${cursorPath}. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      afterTheFolderTookTheLinksPlace: { setup: 'current', removal: 'removed' },
    },
  )
})

// Value: protects=a learner who has a file named skills in ~/.cursor; fails_when=the refusals name no step, tell the learner to delete a file of their own, or the step (rename it or move it) does not end in a finished setup and removal; why_new=Cycle 0046 row 277 (what is no folder, above the skill folder); seam=none, the real file
test('a file where ~/.cursor/skills should be is refused by setup, reconnect and removal as the learner’s own, to rename or to move: after the learner renames it, setup installs the skill, a removal finishes, and the file is unchanged', async (context) => {
  // Arrange: two homes where Cursor chat was never set up and a note of the learner stands at the skills folder's path.
  const homeOfTheSetup = await fixture(context),
    homeOfTheRemoval = await fixture(context)
  for (const paths of [homeOfTheSetup, homeOfTheRemoval]) {
    await mkdir(join(paths.homeRoot, '.cursor'))
    await writeFile(
      join(paths.homeRoot, '.cursor', 'skills'),
      'A note of the learner.\n',
    )
  }
  const skillsPath = join(homeOfTheSetup.homeRoot, '.cursor', 'skills')

  // Act
  const refusals = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(
        homeOfTheSetup.extensionPath,
        homeOfTheSetup.storageRoot,
        homeOfTheSetup.homeRoot,
      ),
    ),
    reconnect: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        homeOfTheSetup.extensionPath,
        homeOfTheSetup.storageRoot,
        homeOfTheSetup.homeRoot,
      ),
    ),
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(
        homeOfTheSetup.storageRoot,
        homeOfTheSetup.homeRoot,
      ),
    ),
  }
  // The sentences are followed to the letter: the file gets another name, and the command is run again.
  await rename(skillsPath, join(homeOfTheSetup.homeRoot, '.cursor', 'notes'))
  const setupAfterTheRename = await statusOrRefusalOf(
    deployCursorSkill(
      homeOfTheSetup.extensionPath,
      homeOfTheSetup.storageRoot,
      homeOfTheSetup.homeRoot,
    ),
  )
  await rename(
    join(homeOfTheRemoval.homeRoot, '.cursor', 'skills'),
    join(homeOfTheRemoval.homeRoot, '.cursor', 'notes'),
  )
  const removalAfterTheRename = await statusOrRefusalOf(
    removeManagedCursorSkill(
      homeOfTheRemoval.storageRoot,
      homeOfTheRemoval.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupAfterTheRename,
      skill: await readFile(homeOfTheSetup.targetPath, 'utf8'),
      noteAfterTheSetup: await readFile(
        join(homeOfTheSetup.homeRoot, '.cursor', 'notes'),
        'utf8',
      ),
      removalAfterTheRename,
      noteAfterTheRemoval: await readFile(
        join(homeOfTheRemoval.homeRoot, '.cursor', 'notes'),
        'utf8',
      ),
    },
    {
      refusals: {
        setup: `Codebook will not follow a non-directory skill path: ${skillsPath}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
        reconnect: `Codebook will not follow a missing or redirected skill directory: ${skillsPath}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not follow a missing or redirected skill directory: ${skillsPath}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      setupAfterTheRename: 'installed',
      skill: INITIAL_SKILL,
      noteAfterTheSetup: 'A note of the learner.\n',
      removalAfterTheRename: 'not-installed',
      noteAfterTheRemoval: 'A note of the learner.\n',
    },
  )
})

// Value: protects=a learner whose ~/.cursor/skills/codebook is a link, to a skill of their own or to Codebook's skill folder that they keep elsewhere; fails_when=the refusals name no step, send the learner to put the linked folder in place (which a setup refuses as a skill it has no receipt for), or change what the link points to; why_new=Cycle 0046 row 277 (the skill folder itself); seam=none, the real links
test('a link at the skill folder ~/.cursor/skills/codebook is refused by setup, reconnect and removal with a sentence that says to remove the link or to rename it: after the learner renames it, setup installs the skill beside it, and after the learner removes it, a removal finishes; what the link points to is unchanged', async (context) => {
  // Arrange: one home whose codebook entry links to a skill of the learner's own, and one whose installed skill folder is kept elsewhere behind a link.
  const homeWithOwnSkill = await fixture(context),
    homeWithMovedSkill = await fixture(context)
  const ownSkillFolder = join(
      homeWithOwnSkill.homeRoot,
      'my-skills',
      'codebook',
    ),
    linkToOwnSkill = join(
      homeWithOwnSkill.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    )
  await mkdir(ownSkillFolder, { recursive: true })
  await writeFile(join(ownSkillFolder, 'SKILL.md'), 'My own codebook skill\n')
  await mkdir(join(homeWithOwnSkill.homeRoot, '.cursor', 'skills'), {
    recursive: true,
  })
  if (!(await createLinkIfAllowed(ownSkillFolder, linkToOwnSkill)))
    return context.skip(LINK_NOT_ALLOWED)
  await deployCursorSkill(
    homeWithMovedSkill.extensionPath,
    homeWithMovedSkill.storageRoot,
    homeWithMovedSkill.homeRoot,
  )
  const movedSkillFolder = join(homeWithMovedSkill.homeRoot, 'kept-codebook'),
    linkToMovedSkill = join(
      homeWithMovedSkill.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    )
  await rename(linkToMovedSkill, movedSkillFolder)
  if (!(await createLinkIfAllowed(movedSkillFolder, linkToMovedSkill)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const refusals = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(
        homeWithOwnSkill.extensionPath,
        homeWithOwnSkill.storageRoot,
        homeWithOwnSkill.homeRoot,
      ),
    ),
    reconnect: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        homeWithOwnSkill.extensionPath,
        homeWithOwnSkill.storageRoot,
        homeWithOwnSkill.homeRoot,
      ),
    ),
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(
        homeWithMovedSkill.storageRoot,
        homeWithMovedSkill.homeRoot,
      ),
    ),
  }
  // The setup's sentence is followed to the letter: the link gets another name.
  await rename(
    linkToOwnSkill,
    join(homeWithOwnSkill.homeRoot, '.cursor', 'skills', 'codebook-of-mine'),
  )
  const setupAfterTheLinkWasRenamed = await statusOrRefusalOf(
    deployCursorSkill(
      homeWithOwnSkill.extensionPath,
      homeWithOwnSkill.storageRoot,
      homeWithOwnSkill.homeRoot,
    ),
  )
  // The removal's sentence is followed to the letter: the link is removed.
  await unlink(linkToMovedSkill)
  const removalAfterTheLinkWasRemoved = await statusOrRefusalOf(
    removeManagedCursorSkill(
      homeWithMovedSkill.storageRoot,
      homeWithMovedSkill.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupAfterTheLinkWasRenamed,
      skill: await readFile(homeWithOwnSkill.targetPath, 'utf8'),
      ownSkillThroughTheRenamedLink: await readFile(
        join(
          homeWithOwnSkill.homeRoot,
          '.cursor',
          'skills',
          'codebook-of-mine',
          'SKILL.md',
        ),
        'utf8',
      ),
      removalAfterTheLinkWasRemoved,
      skillTheRemovedLinkPointedTo: await readFile(
        join(movedSkillFolder, 'SKILL.md'),
        'utf8',
      ),
    },
    {
      refusals: {
        setup: `Codebook will not follow a non-directory skill path: ${linkToOwnSkill}. That path is a link, and Codebook leaves what it points to as it is. Remove the link or give it another name, then run Codebook: Set Up AI Chat again.`,
        reconnect: `Codebook will not follow a missing or redirected skill directory: ${linkToOwnSkill}. That path is a link, and Codebook leaves what it points to as it is. Remove the link or give it another name, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not follow a non-directory skill path: ${linkToMovedSkill}. That path is a link, and Codebook leaves what it points to as it is. Remove the link or give it another name, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      setupAfterTheLinkWasRenamed: 'installed',
      skill: INITIAL_SKILL,
      ownSkillThroughTheRenamedLink: 'My own codebook skill\n',
      removalAfterTheLinkWasRemoved: 'removed',
      skillTheRemovedLinkPointedTo: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner who has a file named codebook in ~/.cursor/skills; fails_when=setup and removal end with a sentence that names the path and no step, or tell the learner to delete the file; why_new=Cycle 0046 row 277 (what is no folder, at the skill folder's path); seam=none, the real file
test('a file where the skill folder ~/.cursor/skills/codebook should be is refused by setup, reconnect and removal as the learner’s own, to rename or to move: after the learner renames it, setup installs the skill, a removal finishes, and the file is unchanged', async (context) => {
  // Arrange: two homes where Cursor chat was never set up and a note of the learner stands at the skill folder's path.
  const homeOfTheSetup = await fixture(context),
    homeOfTheRemoval = await fixture(context)
  for (const paths of [homeOfTheSetup, homeOfTheRemoval]) {
    await mkdir(join(paths.homeRoot, '.cursor', 'skills'), { recursive: true })
    await writeFile(
      join(paths.homeRoot, '.cursor', 'skills', 'codebook'),
      'A note of the learner.\n',
    )
  }
  const skillFolderPath = join(
      homeOfTheSetup.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    ),
    skillFolderPathOfTheRemoval = join(
      homeOfTheRemoval.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    )

  // Act
  const refusals = {
    setup: await statusOrRefusalOf(
      deployCursorSkill(
        homeOfTheSetup.extensionPath,
        homeOfTheSetup.storageRoot,
        homeOfTheSetup.homeRoot,
      ),
    ),
    reconnect: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        homeOfTheSetup.extensionPath,
        homeOfTheSetup.storageRoot,
        homeOfTheSetup.homeRoot,
      ),
    ),
    removal: await statusOrRefusalOf(
      removeManagedCursorSkill(
        homeOfTheRemoval.storageRoot,
        homeOfTheRemoval.homeRoot,
      ),
    ),
  }
  // The sentences are followed to the letter: the file gets another name, and the command is run again.
  await rename(skillFolderPath, `${skillFolderPath}-note`)
  const setupAfterTheRename = await statusOrRefusalOf(
    deployCursorSkill(
      homeOfTheSetup.extensionPath,
      homeOfTheSetup.storageRoot,
      homeOfTheSetup.homeRoot,
    ),
  )
  await rename(
    skillFolderPathOfTheRemoval,
    `${skillFolderPathOfTheRemoval}-note`,
  )
  const removalAfterTheRename = await statusOrRefusalOf(
    removeManagedCursorSkill(
      homeOfTheRemoval.storageRoot,
      homeOfTheRemoval.homeRoot,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupAfterTheRename,
      skill: await readFile(homeOfTheSetup.targetPath, 'utf8'),
      noteAfterTheSetup: await readFile(`${skillFolderPath}-note`, 'utf8'),
      removalAfterTheRename,
      noteAfterTheRemoval: await readFile(
        `${skillFolderPathOfTheRemoval}-note`,
        'utf8',
      ),
    },
    {
      refusals: {
        setup: `Codebook will not follow a non-directory skill path: ${skillFolderPath}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
        reconnect: `Codebook will not follow a missing or redirected skill directory: ${skillFolderPath}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
        removal: `Codebook will not follow a non-directory skill path: ${skillFolderPathOfTheRemoval}. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      setupAfterTheRename: 'installed',
      skill: INITIAL_SKILL,
      noteAfterTheSetup: 'A note of the learner.\n',
      removalAfterTheRename: 'not-installed',
      noteAfterTheRemoval: 'A note of the learner.\n',
    },
  )
})

// Value: protects=a learner whose skill folder, or whose whole ~/.cursor, is gone when the editor starts (deleted by hand, or by a cleanup tool); fails_when=the reconnect ends with "Codebook will not follow a missing or redirected skill directory: …" and neither says that nothing is there nor names a step, or the step does not restore the skill; why_new=Cycle 0046 row 277 (the missing folder, which only a reconnect and a removal's second look refuse); seam=none, the real files
test('a reconnect whose skill folder, or whose whole Cursor folder, is gone says that nothing stands at that path and names the setup, and that setup restores the skill', async (context) => {
  // Arrange: two homes with an installed skill; in one the skill folder is deleted, in the other Cursor's whole settings folder.
  const homeWithoutSkillFolder = await fixture(context),
    homeWithoutCursorFolder = await fixture(context)
  for (const paths of [homeWithoutSkillFolder, homeWithoutCursorFolder])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  const skillFolderPath = join(
      homeWithoutSkillFolder.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    ),
    cursorPath = join(homeWithoutCursorFolder.homeRoot, '.cursor')
  await rm(skillFolderPath, { recursive: true })
  await rm(cursorPath, { recursive: true })

  // Act
  const reconnects = {
    withoutSkillFolder: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        homeWithoutSkillFolder.extensionPath,
        homeWithoutSkillFolder.storageRoot,
        homeWithoutSkillFolder.homeRoot,
      ),
    ),
    withoutCursorFolder: await statusOrRefusalOf(
      verifyManagedCursorSkill(
        homeWithoutCursorFolder.extensionPath,
        homeWithoutCursorFolder.storageRoot,
        homeWithoutCursorFolder.homeRoot,
      ),
    ),
  }
  // The sentences are followed to the letter.
  const setups = {
    withoutSkillFolder: await statusOrRefusalOf(
      deployCursorSkill(
        homeWithoutSkillFolder.extensionPath,
        homeWithoutSkillFolder.storageRoot,
        homeWithoutSkillFolder.homeRoot,
      ),
    ),
    withoutCursorFolder: await statusOrRefusalOf(
      deployCursorSkill(
        homeWithoutCursorFolder.extensionPath,
        homeWithoutCursorFolder.storageRoot,
        homeWithoutCursorFolder.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      reconnects,
      setups,
      skills: [
        await readFile(homeWithoutSkillFolder.targetPath, 'utf8'),
        await readFile(homeWithoutCursorFolder.targetPath, 'utf8'),
      ],
    },
    {
      reconnects: {
        withoutSkillFolder: `Codebook will not follow a missing or redirected skill directory: ${skillFolderPath}. Nothing stands at that path. Run Codebook: Set Up AI Chat again.`,
        withoutCursorFolder: `Codebook will not follow a missing or redirected skill directory: ${cursorPath}. Nothing stands at that path. Run Codebook: Set Up AI Chat again.`,
      },
      setups: {
        withoutSkillFolder: 'restored',
        withoutCursorFolder: 'restored',
      },
      skills: [INITIAL_SKILL, INITIAL_SKILL],
    },
  )
})

// Value: protects=a learner whose skill folder is taken away (by a sync tool, or by hand) in the instant a removal runs; fails_when=the removal's second look at the skill's folders answers without a step, or names the setup to a learner who ran the removal; why_new=Cycle 0046 row 277: the check the reconnect and the removal share takes the command as a parameter; seam=node:fs/promises lstat of the loaded deployment, after whose second look at the skill folder the folder is removed
test('a skill folder that is taken away while a removal runs is answered with the removal as the command to run again, and that removal finishes', async (context) => {
  // Arrange: the installed skill, and a window whose removal loses the skill folder right after it found the folder in place twice.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const skillFolderPath = join(paths.homeRoot, '.cursor', 'skills', 'codebook')
  let looksAtTheSkillFolder = 0
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      lstat: async (path: string, options?: StatOptions) => {
        const look = await fileSystem.lstat(path, options)
        if (path === skillFolderPath) {
          looksAtTheSkillFolder += 1
          if (looksAtTheSkillFolder === 2)
            await rm(skillFolderPath, { recursive: true })
        }
        return look
      },
    },
  })

  // Act
  const removal = await statusOrRefusalOf(
    window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )
  // The sentence is followed to the letter.
  const removalRunAgain = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    { removal, removalRunAgain },
    {
      removal: `Codebook will not follow a missing or redirected skill directory: ${skillFolderPath}. Nothing stands at that path. Run Codebook: Remove Managed Cursor Skill again.`,
      removalRunAgain: 'removed',
    },
  )
})

// Value: protects=a learner who has a skill of their own named codebook in Cursor; fails_when=setup ends with "resolve the name conflict before setup", which names no step, or tells the learner to delete their skill, or a step it names does not end in a finished setup, or the skill is changed; why_new=Cycle 0046 row 277; seam=none, the real files
test('a skill folder named codebook that Codebook has no receipt for is left untouched by setup, which says how to keep it beside Codebook’s skill or to make room: after the learner renames the folder, or moves it elsewhere, setup installs the skill and the learner’s skill is unchanged; kept where it is, it is refused again and nothing is installed', async (context) => {
  // Arrange: three homes with a skill of the learner's own under the name codebook; Cursor chat was never set up.
  const homeThatRenames = await fixture(context),
    homeThatMoves = await fixture(context),
    homeThatKeeps = await fixture(context)
  for (const paths of [homeThatRenames, homeThatMoves, homeThatKeeps]) {
    await mkdir(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), {
      recursive: true,
    })
    await writeFile(paths.targetPath, 'My own codebook skill\n')
  }
  const skillFolderThatIsRenamed = join(
      homeThatRenames.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    ),
    skillFolderThatIsMoved = join(
      homeThatMoves.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    ),
    skillFolderThatIsKept = join(
      homeThatKeeps.homeRoot,
      '.cursor',
      'skills',
      'codebook',
    )

  // Act
  const refusals = {
    renames: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatRenames.extensionPath,
        homeThatRenames.storageRoot,
        homeThatRenames.homeRoot,
      ),
    ),
    moves: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatMoves.extensionPath,
        homeThatMoves.storageRoot,
        homeThatMoves.homeRoot,
      ),
    ),
    keeps: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatKeeps.extensionPath,
        homeThatKeeps.storageRoot,
        homeThatKeeps.homeRoot,
      ),
    ),
  }
  // The sentence is followed to the letter, each of its three ways in one home.
  await rename(skillFolderThatIsRenamed, `${skillFolderThatIsRenamed}-of-mine`)
  await rename(
    skillFolderThatIsMoved,
    join(homeThatMoves.homeRoot, 'codebook-of-mine'),
  )
  const setupsAgain = {
    renames: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatRenames.extensionPath,
        homeThatRenames.storageRoot,
        homeThatRenames.homeRoot,
      ),
    ),
    moves: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatMoves.extensionPath,
        homeThatMoves.storageRoot,
        homeThatMoves.homeRoot,
      ),
    ),
    keeps: await statusOrRefusalOf(
      deployCursorSkill(
        homeThatKeeps.extensionPath,
        homeThatKeeps.storageRoot,
        homeThatKeeps.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupsAgain,
      renames: {
        skill: await readFile(homeThatRenames.targetPath, 'utf8'),
        ownSkill: await readFile(
          join(`${skillFolderThatIsRenamed}-of-mine`, 'SKILL.md'),
          'utf8',
        ),
      },
      moves: {
        skill: await readFile(homeThatMoves.targetPath, 'utf8'),
        ownSkill: await readFile(
          join(homeThatMoves.homeRoot, 'codebook-of-mine', 'SKILL.md'),
          'utf8',
        ),
      },
      keeps: {
        ownSkill: await readFile(homeThatKeeps.targetPath, 'utf8'),
        skillsFolder: await readdir(
          join(homeThatKeeps.homeRoot, '.cursor', 'skills'),
        ),
        skillFolder: await readdir(skillFolderThatIsKept),
      },
    },
    {
      refusals: {
        renames: `A codebook skill directory already exists in Cursor: ${skillFolderThatIsRenamed}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
        moves: `A codebook skill directory already exists in Cursor: ${skillFolderThatIsMoved}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
        keeps: `A codebook skill directory already exists in Cursor: ${skillFolderThatIsKept}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      },
      setupsAgain: {
        renames: 'installed',
        moves: 'installed',
        keeps: `A codebook skill directory already exists in Cursor: ${skillFolderThatIsKept}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      },
      renames: { skill: INITIAL_SKILL, ownSkill: 'My own codebook skill\n' },
      moves: { skill: INITIAL_SKILL, ownSkill: 'My own codebook skill\n' },
      keeps: {
        ownSkill: 'My own codebook skill\n',
        skillsFolder: ['codebook'],
        skillFolder: ['SKILL.md'],
      },
    },
  )
})

// Value: protects=a learner whose own skill file appears in an empty codebook folder in the instant a first setup looks at that folder; fails_when=setup ends with "An existing codebook skill is not owned by this installation; no file was changed.", which names no step, or the step does not end in a finished setup, or the file is changed; why_new=Cycle 0046 row 277: this refusal had no test, it is reached only between setup's look at the folder and its read of the skill file; seam=node:fs/promises readdir of the loaded deployment, after whose look at the skill folder the file is written
test('a skill file that appears in the empty codebook folder while a first setup looks at it is answered as a skill Codebook does not own, with its folder to rename or to move: after the learner renames the folder, setup installs the skill and the file is unchanged', async (context) => {
  // Arrange: an empty codebook folder, no receipt, and a window in which the learner's skill file is written right after setup found the folder empty.
  const paths = await fixture(context)
  const skillFolderPath = join(paths.homeRoot, '.cursor', 'skills', 'codebook')
  await mkdir(skillFolderPath, { recursive: true })
  const window = await skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': {
      ...fileSystem,
      readdir: async (path: string) => {
        const names = await fileSystem.readdir(path)
        if (path === skillFolderPath)
          await writeFile(paths.targetPath, 'My own codebook skill\n')
        return names
      },
    },
  })

  // Act
  const setup = await statusOrRefusalOf(
    window.deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    ),
  )
  const filesAfterTheSetup = await filesOfTheSetup(paths)
  // The sentence is followed to the letter: the folder gets another name.
  await rename(skillFolderPath, `${skillFolderPath}-of-mine`)
  const setupAfterTheRename = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      setup,
      filesAfterTheSetup,
      setupAfterTheRename,
      skill: await readFile(paths.targetPath, 'utf8'),
      ownSkill: await readFile(
        join(`${skillFolderPath}-of-mine`, 'SKILL.md'),
        'utf8',
      ),
    },
    {
      setup: `An existing codebook skill is not owned by this installation; no file was changed. Codebook has no record of having installed ${paths.targetPath}, so it treats that file as yours. To keep it beside Codebook's skill, rename its folder ${skillFolderPath}; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      filesAfterTheSetup: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      setupAfterTheRename: 'installed',
      skill: INITIAL_SKILL,
      ownSkill: 'My own codebook skill\n',
    },
  )
})

// Value: protects=a learner who runs the removal while the record of an interrupted setup stands in Codebook's storage; fails_when=the removal says "Run Codebook: Set Up AI Chat to recover before removal." and does not say to run the removal again, so the learner who wanted the skill gone ends with it installed; or the two steps do not end in a finished removal; why_new=Cycle 0046 row 277; seam=none, the records as an interrupted update and an interrupted first installation leave them
test('a removal that finds the record of an interrupted setup names the setup to recover and the removal to run again after it: for an interrupted update and for an interrupted first installation, that setup finishes and the removal then removes the skill', async (context) => {
  // Arrange: one home whose update of the installed skill stopped after it staged the new skill, and one whose first installation stopped there.
  const homeOfTheUpdate = await fixture(context),
    homeOfTheFirstInstall = await fixture(context)
  await deployCursorSkill(
    homeOfTheUpdate.extensionPath,
    homeOfTheUpdate.storageRoot,
    homeOfTheUpdate.homeRoot,
  )
  await writeUpdateRecord(homeOfTheUpdate)
  const skillsPath = join(homeOfTheFirstInstall.homeRoot, '.cursor', 'skills'),
    receiptDirectory = join(homeOfTheFirstInstall.storageRoot, 'cursor-skill')
  await mkdir(skillsPath, { recursive: true })
  await mkdir(receiptDirectory)
  const stagedPath = join(
    skillsPath,
    '.codebook-stage-00000000-0000-0000-0000-000000000277.tmp',
  )
  await writeFile(stagedPath, INITIAL_SKILL)
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: homeOfTheFirstInstall.targetPath,
      stagedPath,
      skillSha256: createHash('sha256').update(INITIAL_SKILL).digest('hex'),
      skillVersion: '1.0.0',
      extensionVersion: '0.2.3',
      device: staged.dev,
      inode: staged.ino,
    }),
  )

  // Act: the removal, then its sentence to the letter: the setup, and the removal again.
  const outcomes = {
    update: {
      removal: await statusOrRefusalOf(
        removeManagedCursorSkill(
          homeOfTheUpdate.storageRoot,
          homeOfTheUpdate.homeRoot,
        ),
      ),
      setup: await statusOrRefusalOf(
        deployCursorSkill(
          homeOfTheUpdate.extensionPath,
          homeOfTheUpdate.storageRoot,
          homeOfTheUpdate.homeRoot,
        ),
      ),
      removalRunAgain: await statusOrRefusalOf(
        removeManagedCursorSkill(
          homeOfTheUpdate.storageRoot,
          homeOfTheUpdate.homeRoot,
        ),
      ),
    },
    firstInstall: {
      removal: await statusOrRefusalOf(
        removeManagedCursorSkill(
          homeOfTheFirstInstall.storageRoot,
          homeOfTheFirstInstall.homeRoot,
        ),
      ),
      setup: await statusOrRefusalOf(
        deployCursorSkill(
          homeOfTheFirstInstall.extensionPath,
          homeOfTheFirstInstall.storageRoot,
          homeOfTheFirstInstall.homeRoot,
        ),
      ),
      removalRunAgain: await statusOrRefusalOf(
        removeManagedCursorSkill(
          homeOfTheFirstInstall.storageRoot,
          homeOfTheFirstInstall.homeRoot,
        ),
      ),
    },
  }

  // Assert
  assert.deepEqual(
    {
      outcomes,
      skillsFolderOfTheUpdate: await readdir(
        join(homeOfTheUpdate.homeRoot, '.cursor', 'skills'),
      ),
      skillsFolderOfTheFirstInstall: await readdir(skillsPath),
    },
    {
      outcomes: {
        update: {
          removal:
            'Cursor skill setup is interrupted. Run Codebook: Set Up AI Chat to recover, then run Codebook: Remove Managed Cursor Skill again.',
          setup: 'current',
          removalRunAgain: 'removed',
        },
        firstInstall: {
          removal:
            'Cursor skill setup is interrupted. Run Codebook: Set Up AI Chat to recover, then run Codebook: Remove Managed Cursor Skill again.',
          setup: 'installed',
          removalRunAgain: 'removed',
        },
      },
      skillsFolderOfTheUpdate: [],
      skillsFolderOfTheFirstInstall: [],
    },
  )
})

// Value: protects=a learner whose installed extension is damaged: a folder stands where its bundled skill or its Wiki publisher should be; fails_when=setup ends with "Codebook will not change a non-regular skill file: …" and no step, or with a step for a file the learner does not repair (delete or rename it), after which setup answers that the installation is missing that file; why_new=Cycle 0046 row 285; seam=none, the real folders, and an installation put in place anew as a reinstall does
test('a folder where the bundled skill or the Wiki publisher of the installation should be is refused by setup with a sentence that says to install the VSIX again and names the setup: after the installation is put in place anew, setup installs the skill', async (context) => {
  // Arrange: two homes, each with its own installed extension; in one the bundled skill is a folder, in the other the Wiki publisher.
  const withFolderAtSkill = await fixture(context),
    withFolderAtPublisher = await fixture(context)
  const bundledSkillPath = join(
      withFolderAtSkill.extensionPath,
      'skills',
      'codebook',
      'SKILL.md',
    ),
    publisherPath = join(
      withFolderAtPublisher.extensionPath,
      'skills',
      'codebook',
      'publish-wiki.mjs',
    )
  await rm(bundledSkillPath)
  await mkdir(bundledSkillPath)
  await writeFile(withFolderAtPublisher.sourcePath, PUBLISHER_SKILL)
  await mkdir(publisherPath)

  // Act
  const refusals = {
    folderAtSkill: await statusOrRefusalOf(
      deployCursorSkill(
        withFolderAtSkill.extensionPath,
        withFolderAtSkill.storageRoot,
        withFolderAtSkill.homeRoot,
      ),
    ),
    folderAtPublisher: await statusOrRefusalOf(
      deployCursorSkill(
        withFolderAtPublisher.extensionPath,
        withFolderAtPublisher.storageRoot,
        withFolderAtPublisher.homeRoot,
      ),
    ),
  }
  // The sentences are followed to the letter: installing the VSIX again replaces the extension's folder with the packaged files.
  for (const paths of [withFolderAtSkill, withFolderAtPublisher]) {
    await rm(paths.extensionPath, { recursive: true })
    await mkdir(join(paths.extensionPath, 'skills', 'codebook'), {
      recursive: true,
    })
    await writeFile(paths.sourcePath, PUBLISHER_SKILL)
    await writeFile(
      join(paths.extensionPath, 'skills', 'codebook', 'publish-wiki.mjs'),
      '// publisher\n',
    )
  }
  const setupsAfterTheReinstall = {
    folderAtSkill: await statusOrRefusalOf(
      deployCursorSkill(
        withFolderAtSkill.extensionPath,
        withFolderAtSkill.storageRoot,
        withFolderAtSkill.homeRoot,
      ),
    ),
    folderAtPublisher: await statusOrRefusalOf(
      deployCursorSkill(
        withFolderAtPublisher.extensionPath,
        withFolderAtPublisher.storageRoot,
        withFolderAtPublisher.homeRoot,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupsAfterTheReinstall,
      skills: [
        await readFile(withFolderAtSkill.targetPath, 'utf8'),
        await readFile(withFolderAtPublisher.targetPath, 'utf8'),
      ],
    },
    {
      refusals: {
        folderAtSkill: `Codebook will not change a non-regular skill file: ${bundledSkillPath}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
        folderAtPublisher: `Codebook will not change a non-regular skill file: ${publisherPath}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
      },
      setupsAfterTheReinstall: {
        folderAtSkill: 'installed',
        folderAtPublisher: 'installed',
      },
      skills: [
        publisherSkillOf(withFolderAtSkill.extensionPath),
        publisherSkillOf(withFolderAtPublisher.extensionPath),
      ],
    },
  )
})

// Value: protects=a learner whose installed extension holds a link where its bundled skill should be; fails_when=setup says "Put the file itself at that path or remove the link", after which (the link removed) setup answers that the installation is missing its bundled skill instead of finishing; why_new=Cycle 0046 row 285, found beside it in the sentences the row changes; seam=none, the real link
test('a link where the bundled skill of the installation should be is refused by setup with a sentence that says to install the VSIX again, and after the installation is put in place anew, setup installs the skill', async (context) => {
  // Arrange: the bundled skill is kept elsewhere and a link stands in its place.
  const paths = await fixture(context)
  const keptSkillPath = join(paths.homeRoot, 'kept-SKILL.md')
  await rename(paths.sourcePath, keptSkillPath)
  if (!(await createLinkIfAllowed(keptSkillPath, paths.sourcePath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const refusal = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  // The sentence is followed to the letter: installing the VSIX again replaces the extension's folder with the packaged files.
  await rm(paths.extensionPath, { recursive: true })
  await mkdir(join(paths.extensionPath, 'skills', 'codebook'), {
    recursive: true,
  })
  await writeFile(paths.sourcePath, INITIAL_SKILL)
  const setupAfterTheReinstall = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      refusal,
      setupAfterTheReinstall,
      skill: await readFile(paths.targetPath, 'utf8'),
      keptSkill: await readFile(keptSkillPath, 'utf8'),
    },
    {
      refusal: `Codebook will not read through a link: ${paths.sourcePath}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
      setupAfterTheReinstall: 'installed',
      skill: INITIAL_SKILL,
      keptSkill: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner in whose Codebook storage a folder stands where an update keeps the copy of the installed skill; fails_when=every update ends with "Codebook will not change a non-regular skill file: …" and no step, or the step does not end in an updated skill, or the installed skill is changed by the refusal; why_new=Cycle 0046 row 285 (the storage's copy); seam=none, the real folder
test('a folder where Codebook keeps the copy of the installed skill in its storage is refused by an update with a sentence that says to delete or rename it and names the setup: after the learner renames it, setup updates the skill', async (context) => {
  // Arrange: the installed skill, an extension that brings a new one, and a folder under the name of the copy.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const copyPath = join(
    paths.storageRoot,
    'cursor-skill',
    `${createHash('sha256').update(INITIAL_SKILL).digest('hex')}.SKILL.md`,
  )
  await mkdir(copyPath)

  // Act
  const refusal = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )
  const skillAfterTheRefusal = await readFile(paths.targetPath, 'utf8')
  const filesAfterTheRefusal = await filesOfTheSetup(paths)
  // The sentence is followed to the letter: what stands at the path gets another name.
  await rename(copyPath, `${copyPath}.aside`)
  const setupAfterTheRename = await statusOrRefusalOf(
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
  )

  // Assert
  assert.deepEqual(
    {
      refusal,
      skillAfterTheRefusal,
      filesAfterTheRefusal,
      setupAfterTheRename,
      skill: await readFile(paths.targetPath, 'utf8'),
      copy: await readFile(copyPath, 'utf8'),
    },
    {
      refusal: `Codebook will not change a non-regular skill file: ${copyPath}. Delete or rename what stands at that path, then run Codebook: Set Up AI Chat again.`,
      skillAfterTheRefusal: INITIAL_SKILL,
      filesAfterTheRefusal: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
      setupAfterTheRename: 'updated',
      skill: NEXT_SKILL,
      copy: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner whose copy of the installed skill in Codebook's storage was moved elsewhere and left as a link (a tool that moves files and links them back does that); fails_when=an update reads the copy through the link, or its refusal says what the skill file's sentence says ("Remove the link") and not that the file itself may be put there, or names no command, or one of the two steps it names does not end in a finished update; why_new=Cycle 0046 row 348: the sentence for a link at the copy's path was stated by no test, which showed when each sentence's command name was traced to its constant; seam=none, the real link
test('a link where Codebook keeps the copy of the installed skill in its storage is refused by an update with a sentence that says to put the file itself there or to remove the link and names the setup: after the learner puts the file in the link’s place, and after the learner removes the link, setup updates the skill', async (context) => {
  // Arrange: two homes with an installed skill and an extension that brings a new one; the copy of the installed skill lies outside Codebook's storage and a link to it stands under the copy's name.
  const homeThatPutsTheFileBack = await fixture(context),
    homeThatRemovesTheLink = await fixture(context)
  const copyName = `${createHash('sha256').update(INITIAL_SKILL).digest('hex')}.SKILL.md`
  const copyPathOf = (paths: { storageRoot: string }): string =>
    join(paths.storageRoot, 'cursor-skill', copyName)
  const movedCopyPathOf = (paths: { homeRoot: string }): string =>
    join(paths.homeRoot, 'moved-copy.SKILL.md')
  for (const paths of [homeThatPutsTheFileBack, homeThatRemovesTheLink]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.sourcePath, NEXT_SKILL)
    await writeFile(movedCopyPathOf(paths), INITIAL_SKILL)
    if (!(await createLinkIfAllowed(movedCopyPathOf(paths), copyPathOf(paths))))
      return context.skip(LINK_NOT_ALLOWED)
  }
  const setUp = (paths: {
    extensionPath: string
    storageRoot: string
    homeRoot: string
  }): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Act
  const refusals = {
    homeThatPutsTheFileBack: await setUp(homeThatPutsTheFileBack),
    homeThatRemovesTheLink: await setUp(homeThatRemovesTheLink),
  }
  const afterTheRefusal = {
    skill: await readFile(homeThatPutsTheFileBack.targetPath, 'utf8'),
    files: await filesOfTheSetup(homeThatPutsTheFileBack),
  }
  // Each step of the sentence is followed to the letter.
  await rename(
    movedCopyPathOf(homeThatPutsTheFileBack),
    copyPathOf(homeThatPutsTheFileBack),
  )
  await unlink(copyPathOf(homeThatRemovesTheLink))
  const setupsAfterTheStep = {
    homeThatPutsTheFileBack: await setUp(homeThatPutsTheFileBack),
    homeThatRemovesTheLink: await setUp(homeThatRemovesTheLink),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      afterTheRefusal,
      setupsAfterTheStep,
      skills: {
        homeThatPutsTheFileBack: await readFile(
          homeThatPutsTheFileBack.targetPath,
          'utf8',
        ),
        homeThatRemovesTheLink: await readFile(
          homeThatRemovesTheLink.targetPath,
          'utf8',
        ),
      },
      movedCopyOfTheHomeThatRemovedTheLink: await readFile(
        movedCopyPathOf(homeThatRemovesTheLink),
        'utf8',
      ),
    },
    {
      refusals: {
        homeThatPutsTheFileBack: `Codebook will not read through a link: ${copyPathOf(homeThatPutsTheFileBack)}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`,
        homeThatRemovesTheLink: `Codebook will not read through a link: ${copyPathOf(homeThatRemovesTheLink)}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`,
      },
      afterTheRefusal: {
        skill: INITIAL_SKILL,
        files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
      },
      setupsAfterTheStep: {
        homeThatPutsTheFileBack: 'updated',
        homeThatRemovesTheLink: 'updated',
      },
      skills: {
        homeThatPutsTheFileBack: NEXT_SKILL,
        homeThatRemovesTheLink: NEXT_SKILL,
      },
      movedCopyOfTheHomeThatRemovedTheLink: INITIAL_SKILL,
    },
  )
})

// Value: protects=a learner who edited the installed skill file and then runs the setup; fails_when=the refusal says "Restore or remove that edit manually before updating." and names no command, or a way it names does not end in a finished setup, or the learner's renamed file is changed; why_new=Cycle 0046 row 285 (the edited skill); seam=none, the real files
test('an edited Cursor skill is left alone by setup, which says how to go on and names the setup as the command to run again: after the learner undoes the edit in the file, setup updates the skill; after the learner deletes the file, or renames it, setup restores the skill and the renamed file is unchanged', async (context) => {
  // Arrange: three homes with an installed skill that the learner edited in place; the extension of the first brings a new skill.
  const homeThatUndoes = await fixture(context),
    homeThatDeletes = await fixture(context),
    homeThatRenames = await fixture(context)
  for (const paths of [homeThatUndoes, homeThatDeletes, homeThatRenames]) {
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
    await writeFile(paths.targetPath, EDITED_SKILL)
  }
  await writeFile(homeThatUndoes.sourcePath, NEXT_SKILL)
  const setUp = (paths: typeof homeThatUndoes): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Act
  const refusals = {
    undoes: await setUp(homeThatUndoes),
    deletes: await setUp(homeThatDeletes),
    renames: await setUp(homeThatRenames),
  }
  // The sentence is followed to the letter, each of its three ways in one home.
  await writeFile(homeThatUndoes.targetPath, INITIAL_SKILL)
  await rm(homeThatDeletes.targetPath)
  await rename(
    homeThatRenames.targetPath,
    join(homeThatRenames.homeRoot, '.cursor', 'skills', 'codebook', 'MINE.md'),
  )
  const setupsAgain = {
    undoes: await setUp(homeThatUndoes),
    deletes: await setUp(homeThatDeletes),
    renames: await setUp(homeThatRenames),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      setupsAgain,
      skills: {
        undoes: await readFile(homeThatUndoes.targetPath, 'utf8'),
        deletes: await readFile(homeThatDeletes.targetPath, 'utf8'),
        renames: await readFile(homeThatRenames.targetPath, 'utf8'),
      },
      renamedFile: await readFile(
        join(
          homeThatRenames.homeRoot,
          '.cursor',
          'skills',
          'codebook',
          'MINE.md',
        ),
        'utf8',
      ),
    },
    {
      refusals: {
        undoes: `The managed Cursor skill was edited after setup: ${homeThatUndoes.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
        deletes: `The managed Cursor skill was edited after setup: ${homeThatDeletes.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
        renames: `The managed Cursor skill was edited after setup: ${homeThatRenames.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      },
      setupsAgain: {
        undoes: 'updated',
        deletes: 'restored',
        renames: 'restored',
      },
      skills: {
        undoes: NEXT_SKILL,
        deletes: INITIAL_SKILL,
        renames: INITIAL_SKILL,
      },
      renamedFile: EDITED_SKILL,
    },
  )
})

/**
 * Loads the skill deployment as a window in which a program holds the skill file for itself in the instant Codebook compares the file's two names, and only then: the two rules that remove a second name refuse the names a test calls held with `EBUSY`, every other read of the window opens the file.
 * @param isHeld - Asked at every open of the two rules; `true` while the program holds the file under that path.
 * @param fileSystemOfTheWindow - What the window gets for `node:fs/promises`, when something must happen between two of its steps.
 * @returns The window.
 */
async function skillWindowWhoseSkillIsHeld(
  isHeld: (path: string) => boolean,
  fileSystemOfTheWindow: object = fileSystem,
): Promise<typeof CursorSkillModule> {
  const rules = await loadSecondNameRulesOverHeldFiles((path) =>
    isHeld(path) ? 'EBUSY' : undefined,
  )
  return skillWindow(constants.EXTENSION_VERSION, {
    'node:fs/promises': fileSystemOfTheWindow,
    './utils/dropSecondNameOfMovedFile': rules.ofMovedFile,
    './utils/dropSecondNameOfOneFile': rules.ofOneFile,
  })
}

// Value: protects=a learner whose editor holds the skill file for itself (Windows) in the instant a setup puts the edited file back after its move, or removes the staged name of a skill that was edited right after its publication; fails_when=setup answers "Cursor skill changed during an interrupted setup; … The file Codebook had moved away is kept as …", which names a second file that is not there and whose way out (delete the record) leaves the second name; or the next setup does not drop the name; why_new=Cycle 0046 row 308: a name that could not be opened has an answer of its own; seam=the opener of the two rules that remove a second name, which refuses the held file, and node:fs/promises rename and link of the loaded deployment, at which the skill is edited
test('a skill file that a program holds for itself in the instant setup puts it back after a move, or removes its staged name, is answered with both paths and with the step to close the program and run the setup again: the record stays, and the setup after the program let go drops the name, leaves no record and answers for the file', async (context) => {
  // Arrange: one installed skill that is edited right before an update moves it, and one first setup whose published skill is edited at once; in both windows a program holds the file under the names Codebook gave it.
  const movedAway = await fixture(context),
    publishedAndEdited = await fixture(context)
  await deployCursorSkill(
    movedAway.extensionPath,
    movedAway.storageRoot,
    movedAway.homeRoot,
  )
  await writeFile(movedAway.sourcePath, NEXT_SKILL)
  let isProgramHoldingTheFile = true
  const windowOfTheMove = await skillWindowWhoseSkillIsHeld(
    (path) =>
      isProgramHoldingTheFile &&
      path.includes(join('codebook', '.codebook-displaced-')),
    {
      ...fileSystem,
      rename: async (from: string, to: string) => {
        if (from === movedAway.targetPath) await writeFile(from, EDITED_SKILL)
        return fileSystem.rename(from, to)
      },
    },
  )
  const windowOfThePublication = await skillWindowWhoseSkillIsHeld(
    (path) => isProgramHoldingTheFile && path.includes('.codebook-stage-'),
    {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await fileSystem.link(existingPath, newPath)
        if (newPath === publishedAndEdited.targetPath)
          await writeFile(newPath, EDITED_SKILL)
      },
    },
  )
  const setUp = (
    window: typeof CursorSkillModule,
    paths: typeof movedAway,
  ): Promise<string> =>
    statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )

  // Act: the setups while the program holds the file, and then the sentence to the letter: the program lets go, and the setup is run again.
  const setups = {
    movedAway: await setUp(windowOfTheMove, movedAway),
    publishedAndEdited: await setUp(windowOfThePublication, publishedAndEdited),
  }
  const filesWhileHeld = {
    movedAway: await filesOfTheSetup(movedAway),
    publishedAndEdited: await filesOfTheSetup(publishedAndEdited),
  }
  isProgramHoldingTheFile = false
  const setupsAgain = {
    movedAway: await setUp(windowOfTheMove, movedAway),
    publishedAndEdited: await setUp(windowOfThePublication, publishedAndEdited),
  }
  const displacedName =
    filesWhileHeld.movedAway.skillFolder.find((name) =>
      name.startsWith('.codebook-displaced-'),
    ) ?? 'no displaced name'
  const stagedName =
    filesWhileHeld.publishedAndEdited.temporaryNames[0] ?? 'no staged name'

  // Assert
  assert.deepEqual(
    {
      setups,
      filesWhileHeld,
      setupsAgain,
      filesAfterwards: {
        movedAway: await filesOfTheSetup(movedAway),
        publishedAndEdited: await filesOfTheSetup(publishedAndEdited),
      },
      skills: [
        await readFile(movedAway.targetPath, 'utf8'),
        await readFile(publishedAndEdited.targetPath, 'utf8'),
      ],
    },
    {
      setups: {
        movedAway: `The Cursor skill could not be opened, so Codebook left ${movedAway.targetPath} and the name it had given the file, ${join(movedAway.homeRoot, '.cursor', 'skills', 'codebook', displacedName)}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
        publishedAndEdited: `The Cursor skill could not be opened, so Codebook left ${publishedAndEdited.targetPath} and the name it had given the file, ${join(publishedAndEdited.homeRoot, '.cursor', 'skills', stagedName)}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
      },
      filesWhileHeld: {
        movedAway: {
          skillFolder: [displacedName, 'SKILL.md'],
          temporaryNames: [],
          records: ['pending.json'],
        },
        publishedAndEdited: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [stagedName],
          records: ['pending.json'],
        },
      },
      setupsAgain: {
        movedAway: `The managed Cursor skill was edited after setup: ${movedAway.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
        publishedAndEdited: `A codebook skill directory already exists in Cursor: ${join(publishedAndEdited.homeRoot, '.cursor', 'skills', 'codebook')}. Codebook left it untouched: it has no record of having installed that folder, so it treats what is in it as yours. To keep it beside Codebook's skill, rename that folder; to make room without it, move the folder elsewhere. Then run Codebook: Set Up AI Chat again. If you keep it where it is, Codebook leaves it alone and installs no skill.`,
      },
      filesAfterwards: {
        movedAway: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [],
          records: [],
        },
        publishedAndEdited: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [],
          records: [],
        },
      },
      skills: [EDITED_SKILL, EDITED_SKILL],
    },
  )
})

// Value: protects=a learner whose editor holds the skill file for itself in the instant a removal puts the edited file back after its move, and at the recovery of such a removal by a setup; fails_when=the removal answers "Cursor skill changed during interrupted removal; Codebook preserved it and the displaced file (…)", which names a second file that is not there, or names the setup to a learner who ran the removal; or the next run does not drop the name; why_new=Cycle 0046 row 308 (the removal, and its record's recovery with the command that was run); seam=the opener of the two rules that remove a second name, which refuses the held file, and node:fs/promises rename of the loaded deployment, before whose move the skill is edited
test('a skill file that a program holds for itself in the instant a removal puts it back after its move is answered with both paths and names the removal as the command to run again, and the setup that recovers such a removal names the setup: the record stays, and the run after the program let go drops the name and answers for the edit', async (context) => {
  // Arrange: one installed skill that is edited right before the removal moves it, and one whose removal stopped with the edited file under both names; a program holds the file under its displaced name.
  const removed = await fixture(context),
    recoveredBySetup = await fixture(context)
  for (const paths of [removed, recoveredBySetup])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  const leftByAStoppedRemoval = await writeRemovalRecord(recoveredBySetup)
  await writeFile(recoveredBySetup.targetPath, EDITED_SKILL)
  await fileSystem.link(
    recoveredBySetup.targetPath,
    leftByAStoppedRemoval.displacedPath,
  )
  let isProgramHoldingTheFile = true
  const isHeld = (path: string): boolean =>
    isProgramHoldingTheFile &&
    path.includes(join('codebook', '.codebook-displaced-'))
  const windowOfTheRemoval = await skillWindowWhoseSkillIsHeld(isHeld, {
    ...fileSystem,
    rename: async (from: string, to: string) => {
      if (from === removed.targetPath) await writeFile(from, EDITED_SKILL)
      return fileSystem.rename(from, to)
    },
  })
  const windowOfTheSetup = await skillWindowWhoseSkillIsHeld(isHeld)
  const remove = (): Promise<string> =>
    statusOrRefusalOf(
      windowOfTheRemoval.removeManagedCursorSkill(
        removed.storageRoot,
        removed.homeRoot,
      ),
    )
  const setUp = (): Promise<string> =>
    statusOrRefusalOf(
      windowOfTheSetup.deployCursorSkill(
        recoveredBySetup.extensionPath,
        recoveredBySetup.storageRoot,
        recoveredBySetup.homeRoot,
      ),
    )

  // Act: each command while the program holds the file, and then its sentence to the letter.
  const whileHeld = { removal: await remove(), setup: await setUp() }
  const filesWhileHeld = {
    removed: await filesOfTheSetup(removed),
    recoveredBySetup: await filesOfTheSetup(recoveredBySetup),
  }
  isProgramHoldingTheFile = false
  const afterwards = { removal: await remove(), setup: await setUp() }
  const displacedNameOfTheRemoval =
    filesWhileHeld.removed.skillFolder.find((name) =>
      name.startsWith('.codebook-displaced-'),
    ) ?? 'no displaced name'

  // Assert
  assert.deepEqual(
    {
      whileHeld,
      filesWhileHeld,
      afterwards,
      filesAfterwards: {
        removed: await filesOfTheSetup(removed),
        recoveredBySetup: await filesOfTheSetup(recoveredBySetup),
      },
    },
    {
      whileHeld: {
        removal: `The Cursor skill could not be opened, so Codebook left ${removed.targetPath} and the name it had given the file, ${join(removed.homeRoot, '.cursor', 'skills', 'codebook', displacedNameOfTheRemoval)}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        setup: `The Cursor skill could not be opened, so Codebook left ${recoveredBySetup.targetPath} and the name it had given the file, ${leftByAStoppedRemoval.displacedPath}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
      },
      filesWhileHeld: {
        removed: {
          skillFolder: [displacedNameOfTheRemoval, 'SKILL.md'],
          temporaryNames: [],
          records: ['removal.json'],
        },
        recoveredBySetup: {
          skillFolder: [
            '.codebook-displaced-00000000-0000-0000-0000-000000000189.tmp',
            'SKILL.md',
          ],
          temporaryNames: [],
          records: ['removal.json'],
        },
      },
      afterwards: {
        removal: `The Cursor skill was edited after setup: ${removed.targetPath}. Codebook preserved it. Codebook leaves that file alone as long as it is there. To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.`,
        setup: `The managed Cursor skill was edited after setup: ${recoveredBySetup.targetPath}. Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.`,
      },
      filesAfterwards: {
        removed: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
        recoveredBySetup: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [],
          records: [],
        },
      },
    },
  )
})

// Value: protects=a staged name that an earlier setup left as a second name of the skill file, while a program holds that file; fails_when=the setup's cleanup of names no record knows ends the setup with a refusal or the file system's text, or removes the name without knowing whose it is; why_new=Cycle 0046 row 308: in the cleanup a name that could not be opened stays, and a later setup looks at it again; seam=the opener of the two rules that remove a second name, which refuses the held file
test('a staged name no record names, of a skill file that a program holds for itself, is left by setup, which finishes all the same, and is removed by the setup after the program let go', async (context) => {
  // Arrange: the installed skill with a second name under a staged name, as a setup that stopped right after its publication leaves it once its record is gone.
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  const stagedName = '.codebook-stage-00000000-0000-0000-0000-000000000308.tmp'
  await fileSystem.link(
    paths.targetPath,
    join(paths.homeRoot, '.cursor', 'skills', stagedName),
  )
  let isProgramHoldingTheFile = true
  const window = await skillWindowWhoseSkillIsHeld(
    (path) => isProgramHoldingTheFile && path === paths.targetPath,
  )
  const setUp = (): Promise<string> =>
    statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )

  // Act
  const setupWhileHeld = await setUp()
  const filesWhileHeld = await filesOfTheSetup(paths)
  isProgramHoldingTheFile = false
  const setupAfterwards = await setUp()

  // Assert
  assert.deepEqual(
    {
      setupWhileHeld,
      filesWhileHeld,
      setupAfterwards,
      filesAfterwards: await filesOfTheSetup(paths),
    },
    {
      setupWhileHeld: 'current',
      filesWhileHeld: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [stagedName],
        records: [],
      },
      setupAfterwards: 'current',
      filesAfterwards: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
    },
  )
})

// Value: protects=a learner whose installed extension lacks its bundled skill or its Wiki publisher, or holds a bundled skill without a version; fails_when=setup ends with "This Codebook installation is missing its bundled skill. Reinstall the VSIX.", which names neither the file nor the command to run afterwards, while the refusals of a link or a folder at the same paths name both; why_new=Cycle 0046, the pass over every sentence of the Cursor setup after rows 277 to 309; seam=none, the real files, and an installation put in place anew as a reinstall does
test('an installation whose bundled skill or Wiki publisher is missing, or whose bundled skill has no version, is refused by setup with the file’s path and the step to install the VSIX again and run the setup: after the installation is put in place anew, setup installs the skill', async (context) => {
  // Arrange: three homes, each with its own installed extension that lacks one thing.
  const withoutSkill = await fixture(context),
    withInvalidSkill = await fixture(context),
    withoutPublisher = await fixture(context)
  await rm(withoutSkill.sourcePath)
  await writeFile(withInvalidSkill.sourcePath, 'A skill without a version.\n')
  await writeFile(withoutPublisher.sourcePath, PUBLISHER_SKILL)
  const setUp = (paths: typeof withoutSkill): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    )

  // Act
  const refusals = {
    withoutSkill: await setUp(withoutSkill),
    withInvalidSkill: await setUp(withInvalidSkill),
    withoutPublisher: await setUp(withoutPublisher),
  }
  // The sentences are followed to the letter: installing the VSIX again replaces the extension's folder with the packaged files.
  for (const paths of [withoutSkill, withInvalidSkill, withoutPublisher]) {
    await rm(paths.extensionPath, { recursive: true })
    await mkdir(join(paths.extensionPath, 'skills', 'codebook'), {
      recursive: true,
    })
    await writeFile(paths.sourcePath, PUBLISHER_SKILL)
    await writeFile(
      join(paths.extensionPath, 'skills', 'codebook', 'publish-wiki.mjs'),
      '// publisher\n',
    )
  }
  const setupsAfterTheReinstall = {
    withoutSkill: await setUp(withoutSkill),
    withInvalidSkill: await setUp(withInvalidSkill),
    withoutPublisher: await setUp(withoutPublisher),
  }

  // Assert
  assert.deepEqual(
    { refusals, setupsAfterTheReinstall },
    {
      refusals: {
        withoutSkill: `This Codebook installation is missing its bundled skill: ${withoutSkill.sourcePath}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
        withInvalidSkill: `This Codebook installation has an invalid bundled skill: ${withInvalidSkill.sourcePath}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
        withoutPublisher: `This Codebook installation is missing its Wiki publisher: ${join(withoutPublisher.extensionPath, 'skills', 'codebook', 'publish-wiki.mjs')}. That path is part of the Codebook installation. Install the verified VSIX again (README, "Install the private VSIX"), then run Codebook: Set Up AI Chat again.`,
      },
      setupsAfterTheReinstall: {
        withoutSkill: 'installed',
        withInvalidSkill: 'installed',
        withoutPublisher: 'installed',
      },
    },
  )
})

/**
 * Loads the skill deployment as a window whose reader the system refuses to open the files a test calls held, as it does for a file another program holds for itself or this user may not read. Only the reader's opens are refused; the rules that compare a file's two names open the file as it is.
 * @param refusalOf - Asked at every open of the reader: the code and the system's words to refuse the path with, or undefined to open it.
 * @returns The window.
 */
async function skillWindowWhoseReaderIsRefused(
  refusalOf: (path: string) => { code: string; words: string } | undefined,
): Promise<typeof CursorSkillModule> {
  return skillWindow(constants.EXTENSION_VERSION, {
    './utils/openWithoutFollowing': {
      openWithoutFollowing: async (
        path: string,
      ): Promise<fileSystem.FileHandle> => {
        const refusal = refusalOf(path)
        if (refusal)
          throw Object.assign(
            new Error(`${refusal.code}: ${refusal.words}, open '${path}'`),
            { code: refusal.code },
          )
        return openWithoutFollowing(path)
      },
    },
  })
}

// Value: protects=a learner whose editor holds a file of the Cursor skill setup for itself (Windows), or who may not read it, while a setup, a reconnect or a removal runs; fails_when=the command ends with the file system's own text ("EBUSY: resource busy or locked, open '…SKILL.md'"), which names no step and no command; or a file nobody could look at is taken for one that is not Codebook's (a staged file is left and its record dropped) or a record for an invalid one ("delete it"); why_new=Cycle 0046 row 310: the three codes of a file that cannot be opened have a sentence at every read of the skill setup; seam=the opener of the loaded deployment's reader, which refuses the held file
test('a file of the Cursor skill setup that this user cannot open at that moment is answered by setup, reconnect and removal with the file’s path, the system’s code, the step and the command that was run, at the skill file, at the receipt and at the staged file of an interrupted setup: nothing is changed, no file is taken for one that is not Codebook’s, and the run after the program let go finishes', async (context) => {
  // Arrange: three homes with an installed skill. In the first the extension brings a new skill and a program holds the skill file; in the second this user may not read the receipt; in the third an update stopped after it staged the new skill, and the staged file cannot be opened.
  const withHeldSkill = await fixture(context),
    withHeldReceipt = await fixture(context),
    withHeldStage = await fixture(context)
  for (const paths of [withHeldSkill, withHeldReceipt, withHeldStage])
    await deployCursorSkill(
      paths.extensionPath,
      paths.storageRoot,
      paths.homeRoot,
    )
  await writeFile(withHeldSkill.sourcePath, NEXT_SKILL)
  const receiptPath = join(
    withHeldReceipt.storageRoot,
    'cursor-skill',
    'receipt.json',
  )
  const receiptBefore = await readFile(receiptPath, 'utf8')
  const { stagedPath } = await writeUpdateRecord(withHeldStage)
  let isProgramHoldingTheFiles = true
  const window = await skillWindowWhoseReaderIsRefused((path) =>
    isProgramHoldingTheFiles
      ? {
          [withHeldSkill.targetPath]: {
            code: 'EBUSY',
            words: 'resource busy or locked',
          },
          [receiptPath]: { code: 'EACCES', words: 'permission denied' },
          [stagedPath]: { code: 'EPERM', words: 'operation not permitted' },
        }[path]
      : undefined,
  )
  const setUp = (paths: typeof withHeldSkill): Promise<string> =>
    statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )
  const reconnect = (paths: typeof withHeldSkill): Promise<string> =>
    statusOrRefusalOf(
      window.verifyManagedCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    )
  const remove = (paths: typeof withHeldSkill): Promise<string> =>
    statusOrRefusalOf(
      window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    )

  // Act: every command while the files are held, and then each sentence to the letter: the program lets go, and the command is run again.
  const whileHeld = {
    skill: {
      setup: await setUp(withHeldSkill),
      reconnect: await reconnect(withHeldSkill),
      removal: await remove(withHeldSkill),
    },
    receipt: {
      setup: await setUp(withHeldReceipt),
      reconnect: await reconnect(withHeldReceipt),
      removal: await remove(withHeldReceipt),
    },
    stagedFile: { setup: await setUp(withHeldStage) },
  }
  const filesWhileHeld = {
    skill: await readFile(withHeldSkill.targetPath, 'utf8'),
    filesOfTheHeldSkill: await filesOfTheSetup(withHeldSkill),
    receiptIsUnchanged: (await readFile(receiptPath, 'utf8')) === receiptBefore,
    skillOfTheHeldReceipt: await readFile(withHeldReceipt.targetPath, 'utf8'),
    filesOfTheHeldStage: await filesOfTheSetup(withHeldStage),
    stagedFile: await readFile(stagedPath, 'utf8'),
  }
  isProgramHoldingTheFiles = false
  const afterwards = {
    skill: {
      setup: await setUp(withHeldSkill),
      reconnect: await reconnect(withHeldSkill),
      removal: await remove(withHeldSkill),
    },
    receipt: {
      setup: await setUp(withHeldReceipt),
      removal: await remove(withHeldReceipt),
    },
    stagedFile: { setup: await setUp(withHeldStage) },
  }

  // Assert
  assert.deepEqual(
    {
      whileHeld,
      filesWhileHeld,
      afterwards,
      filesOfTheStageAfterwards: await filesOfTheSetup(withHeldStage),
    },
    {
      whileHeld: {
        skill: {
          setup: `A file of the Cursor skill setup could not be opened: ${withHeldSkill.targetPath} (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
          reconnect: `A file of the Cursor skill setup could not be opened: ${withHeldSkill.targetPath} (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
          removal: `A file of the Cursor skill setup could not be opened: ${withHeldSkill.targetPath} (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        },
        receipt: {
          setup: `A file of the Cursor skill setup could not be opened: ${receiptPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
          reconnect: `A file of the Cursor skill setup could not be opened: ${receiptPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
          removal: `A file of the Cursor skill setup could not be opened: ${receiptPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        },
        stagedFile: {
          setup: `A file of the Cursor skill setup could not be opened: ${stagedPath} (EPERM). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
        },
      },
      filesWhileHeld: {
        skill: INITIAL_SKILL,
        filesOfTheHeldSkill: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [],
          records: [],
        },
        receiptIsUnchanged: true,
        skillOfTheHeldReceipt: INITIAL_SKILL,
        filesOfTheHeldStage: {
          skillFolder: ['SKILL.md'],
          temporaryNames: [
            '.codebook-stage-00000000-0000-0000-0000-000000000188.tmp',
          ],
          records: ['pending.json'],
        },
        stagedFile: NEXT_SKILL,
      },
      afterwards: {
        skill: { setup: 'updated', reconnect: 'current', removal: 'removed' },
        receipt: { setup: 'current', removal: 'removed' },
        stagedFile: { setup: 'current' },
      },
      filesOfTheStageAfterwards: {
        skillFolder: ['SKILL.md'],
        temporaryNames: [],
        records: [],
      },
    },
  )
})

// Value: protects=the boundary of the sentences for a file that could not be opened: only a missing right and a program that holds the file have one; fails_when=another failure of an open of the skill setup (too many open files, a failing disk) is worded by Codebook with a step it cannot know, or is taken for a file that is missing or not Codebook's, instead of reaching the learner as the system's own text; why_new=Cycle 0046 row 310: every other failure of an open is the system's own text; seam=the opener of the loaded deployment's reader, which refuses the skill file with EMFILE
test('a failure of an open of the Cursor skill setup that is neither a missing right nor a program that holds the file ends setup, reconnect and removal with the system’s own text, as it is, and changes nothing', async (context) => {
  // Arrange: the installed skill, an extension that brings a new one, and a reader whose open of the skill file the system refuses with "too many open files".
  const paths = await fixture(context)
  await deployCursorSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const window = await skillWindowWhoseReaderIsRefused((path) =>
    path === paths.targetPath
      ? { code: 'EMFILE', words: 'too many open files' }
      : undefined,
  )

  // Act
  const outcomes = {
    setup: await statusOrRefusalOf(
      window.deployCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
    reconnect: await statusOrRefusalOf(
      window.verifyManagedCursorSkill(
        paths.extensionPath,
        paths.storageRoot,
        paths.homeRoot,
      ),
    ),
    removal: await statusOrRefusalOf(
      window.removeManagedCursorSkill(paths.storageRoot, paths.homeRoot),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      outcomes,
      skill: await readFile(paths.targetPath, 'utf8'),
      files: await filesOfTheSetup(paths),
    },
    {
      outcomes: {
        setup: `EMFILE: too many open files, open '${paths.targetPath}'`,
        reconnect: `EMFILE: too many open files, open '${paths.targetPath}'`,
        removal: `EMFILE: too many open files, open '${paths.targetPath}'`,
      },
      skill: INITIAL_SKILL,
      files: { skillFolder: ['SKILL.md'], temporaryNames: [], records: [] },
    },
  )
})

// Value: protects=a learner whose home folder has a path close to the longest a system allows (about 3,900 of Linux's 4,096 bytes); fails_when=every update of the Cursor skill ends with "Storage limit exceeded (16384 bytes); existing data was retained.", which names neither what is too large nor a way on, although one exists: a removal and a new setup need no record of that size; why_new=Cycle 0046 row 311: the one record of the Cursor setup that can reach its limit, and where; seam=none, a real home folder with a path of 3,900 bytes (the test skips where the system allows no such path)
test('an update of the Cursor skill in a home folder whose path is so long that the update’s record would be larger than Codebook writes is refused with what is too large and the way on, and changes no skill file: after the learner runs the removal and then the setup, the new skill is installed', async (context) => {
  // Arrange: an installed skill in a home folder whose path is 3,900 bytes long, and an extension that brings a new skill.
  const paths = await fixture(context)
  let homeRoot = join(paths.homeRoot, 'long')
  // Each step adds 255 bytes, a separator and a name of 254, and the steps end while 2 to 256 bytes are missing: a separator and a last name of 1 to 255 bytes, the longest name a file system takes.
  while (3_900 - Buffer.byteLength(homeRoot) > 256)
    homeRoot = join(homeRoot, 'd'.repeat(254))
  homeRoot = join(homeRoot, 'e'.repeat(3_900 - Buffer.byteLength(homeRoot) - 1))
  // The path is the one the title names before anything is made of it: 3,900 bytes, and no name in it longer than a file system takes.
  assert.deepEqual(
    {
      homePathBytes: Buffer.byteLength(homeRoot),
      namesLongerThan255Bytes: homeRoot
        .split(sep)
        .filter((name) => Buffer.byteLength(name) > 255).length,
    },
    { homePathBytes: 3_900, namesLongerThan255Bytes: 0 },
  )
  const isHomeMade = await mkdir(homeRoot, { recursive: true }).then(
    () => true,
    () => false,
  )
  if (!isHomeMade)
    return context.skip(
      'this system allows no folder with a path of 3,900 bytes, so no record of the Cursor setup reaches its limit here',
    )
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')
  const setUp = (): Promise<string> =>
    statusOrRefusalOf(
      deployCursorSkill(paths.extensionPath, paths.storageRoot, homeRoot),
    )

  // Act
  const firstSetup = await setUp()
  await writeFile(paths.sourcePath, NEXT_SKILL)
  const update = await setUp()
  const afterTheRefusal = {
    skill: await readFile(targetPath, 'utf8'),
    temporaryNames: (await readdir(join(homeRoot, '.cursor', 'skills'))).filter(
      (name) => name.startsWith('.codebook-'),
    ),
    records: (await readdir(join(paths.storageRoot, 'cursor-skill'))).filter(
      (name) => name === 'pending.json',
    ),
  }
  // The sentence is followed to the letter.
  const removal = await statusOrRefusalOf(
    removeManagedCursorSkill(paths.storageRoot, homeRoot),
  )
  const setupAfterTheRemoval = await setUp()

  // Assert
  assert.deepEqual(
    {
      firstSetup,
      update,
      afterTheRefusal,
      removal,
      setupAfterTheRemoval,
      skill: await readFile(targetPath, 'utf8'),
    },
    {
      firstSetup: 'installed',
      update:
        "Cursor skill could not be updated: the record Codebook keeps of an update would be larger than it writes (16384 bytes), because the paths of this home folder, of the editor's storage and of the installed extension are very long. No skill file was changed. Run Codebook: Remove Managed Cursor Skill, then Codebook: Set Up AI Chat: the skill is installed anew then, which needs no such record.",
      afterTheRefusal: {
        skill: INITIAL_SKILL,
        temporaryNames: [],
        records: [],
      },
      removal: 'removed',
      setupAfterTheRemoval: 'restored',
      skill: NEXT_SKILL,
    },
  )
})

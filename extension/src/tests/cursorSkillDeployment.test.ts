import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
import { withStorageLock } from '../utils/withStorageLock'

import { loadModule } from './utils/loadModule'

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
  await deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
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

// Value: protects=a reconnect telling another window's regular update from an edit; fails_when=the receipt is read before and the file after another window replaced both, and the reconnect answers that the skill is missing or was changed; why_new=Cycle 0045 (RT-8, PC-4.7); seam=the reconnecting window's file reads
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
  await deployCursorSkill(previousExtension, paths.storageRoot, paths.homeRoot)
  const receiptPath = join(paths.storageRoot, 'cursor-skill', 'receipt.json')
  let hasOtherWindowUpdated = false
  let otherWindowResult: string | undefined
  const reconnectingWindow = await skillWindow('0.2.28', {
    'node:fs/promises': {
      ...fileSystem,
      readFile: async (path: string): Promise<Buffer> => {
        const bytes = await readFile(path)
        // Right after this window read the receipt, the other window replaces the skill and writes its receipt, once.
        if (path === receiptPath && !hasOtherWindowUpdated) {
          hasOtherWindowUpdated = true
          const updated = await verifyManagedCursorSkill(
            runningExtension,
            paths.storageRoot,
            paths.homeRoot,
          )
          otherWindowResult = updated.status
        }
        return bytes
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

  // Act
  const editedReconnect = verifyManagedCursorSkill(
    edited.extensionPath,
    edited.storageRoot,
    edited.homeRoot,
  )
  const replacedReconnect = verifyManagedCursorSkill(
    replaced.extensionPath,
    replaced.storageRoot,
    replaced.homeRoot,
  )

  // Assert
  await assert.rejects(editedReconnect, {
    message:
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  })
  await assert.rejects(replacedReconnect, {
    message:
      'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
  })
})

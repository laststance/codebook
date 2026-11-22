import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fileSystem from 'node:fs/promises'
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import {
  deployDevinSkill,
  removeManagedDevinSkill,
} from '../cursorSkillDeployment'
import type * as SkillDeploymentModule from '../cursorSkillDeployment'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const PUBLISHER_MARKER = '{{CODEBOOK_PUBLISHER_PATH}}'
const INITIAL_SKILL = `---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nPublish with node ${PUBLISHER_MARKER}.\n`
const NEXT_SKILL =
  '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.1"\n---\n\nUse current state first.\n'

/** Creates an isolated package with its publisher, a private storage folder and a user home for the Devin skill deployment. @example await fixture(t) // { extensionPath, storageRoot, homeRoot, skillFolder, targetPath, sourcePath, publisherPath } */
async function fixture(context: {
  after: (callback: () => Promise<void>) => void
}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-devin-skill-'))
  context.after(() => removeTestFolder(directory))
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home')
  const sourceDirectory = join(extensionPath, 'skills', 'codebook'),
    skillFolder = join(homeRoot, '.config', 'devin', 'skills', 'codebook')
  await mkdir(sourceDirectory, { recursive: true })
  await mkdir(storageRoot)
  await mkdir(homeRoot)
  await writeFile(join(sourceDirectory, 'SKILL.md'), INITIAL_SKILL)
  await writeFile(
    join(sourceDirectory, 'publish-wiki.mjs'),
    'console.log("publisher");\n',
  )
  return {
    extensionPath,
    storageRoot,
    homeRoot,
    skillFolder,
    targetPath: join(skillFolder, 'SKILL.md'),
    sourcePath: join(sourceDirectory, 'SKILL.md'),
    publisherPath: join(sourceDirectory, 'publish-wiki.mjs'),
  }
}

// Value: protects=Devin Desktop finds Codebook's skill as /devin:codebook because setup writes the packaged bytes, with this installation's publisher path filled in, to ~/.config/devin/skills/codebook/SKILL.md and keeps its receipt apart from Cursor's; fails_when=setup writes under ~/.cursor, leaves the publisher marker in the file, or records the receipt in cursor-skill; no_claim=that Devin Local loads the skill (native check N2)
test('Devin setup installs the packaged skill with the publisher path filled in and records its receipt under devin-skill', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const expectedBody = INITIAL_SKILL.replaceAll(
    PUBLISHER_MARKER,
    paths.publisherPath,
  )
  // Act
  const result = await deployDevinSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(result.status, 'installed')
  assert.equal(result.path, paths.targetPath)
  assert.equal(await readFile(paths.targetPath, 'utf8'), expectedBody)
  assert.equal(
    result.sha256,
    createHash('sha256').update(expectedBody).digest('hex'),
  )
  assert.equal(
    (
      await readFile(join(paths.storageRoot, 'devin-skill', 'receipt.json'))
    ).includes(result.sha256),
    true,
  )
  await assert.rejects(lstat(join(paths.homeRoot, '.cursor')), {
    code: 'ENOENT',
  })
  await assert.rejects(lstat(join(paths.storageRoot, 'cursor-skill')), {
    code: 'ENOENT',
  })
})

// Value: protects=a skill folder the learner already keeps under the name codebook in Devin's skill folder is never overwritten by setup, and the refusal names Devin Desktop; fails_when=the file changes, setup installs over it, or the sentence names Cursor; no_claim=refusals for links or interrupted records (the Cursor tests cover the shared code)
test('Devin setup refuses an unreceipted codebook skill folder and leaves it unchanged', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const custom = 'My own codebook skill'
  await mkdir(paths.skillFolder, { recursive: true })
  await writeFile(paths.targetPath, custom)
  // Act / Assert
  await assert.rejects(
    deployDevinSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    (error: Error) =>
      error.message.startsWith(
        `A codebook skill directory already exists in Devin Desktop: ${paths.skillFolder}.`,
      ) && !error.message.includes('Cursor'),
  )
  assert.equal(await readFile(paths.targetPath, 'utf8'), custom)
  assert.deepEqual(await readdir(paths.skillFolder), ['SKILL.md'])
})

// Value: protects=an extension update reaches Devin's installed skill: a receipted, unedited skill is replaced by the new packaged bytes; fails_when=the outdated skill stays, or the update is refused as another skill; no_claim=the update of a skill the learner edited (shared code, Cursor tests)
test('Devin setup updates an outdated receipted skill to the new packaged bytes', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployDevinSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot)
  await writeFile(paths.sourcePath, NEXT_SKILL)
  // Act
  const updated = await deployDevinSkill(
    paths.extensionPath,
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(updated.status, 'updated')
  assert.equal(updated.version, '1.0.1')
  assert.equal(await readFile(paths.targetPath, 'utf8'), NEXT_SKILL)
})

// Value: protects=Remove Devin Desktop Setup deletes only Codebook's receipted skill and keeps the learner's other skills beside it; fails_when=a neighbouring skill is deleted, the codebook skill remains, or the skills folder is removed; no_claim=removal of the MCP entry (separate module)
test('Devin removal deletes only the receipted skill and keeps another skill beside it', async (context) => {
  // Arrange
  const paths = await fixture(context)
  await deployDevinSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot)
  const otherSkillPath = join(
    paths.homeRoot,
    '.config',
    'devin',
    'skills',
    'my-skill',
    'SKILL.md',
  )
  await mkdir(join(otherSkillPath, '..'), { recursive: true })
  await writeFile(otherSkillPath, 'Another skill')
  // Act
  const removed = await removeManagedDevinSkill(
    paths.storageRoot,
    paths.homeRoot,
  )
  // Assert
  assert.equal(removed.status, 'removed')
  await assert.rejects(lstat(paths.skillFolder), { code: 'ENOENT' })
  assert.equal(await readFile(otherSkillPath, 'utf8'), 'Another skill')
})

// Value: protects=a Devin Desktop learner whose home folder is on a file system without hard links reads a sentence naming Devin Desktop and the path; fails_when=the refusal names Cursor, shows the raw EPERM text, or changes a file; why_new=host label of the shared link refusal is new; seam=node:fs/promises link of the loaded deployment, as the Cursor test does
test('Devin setup on a file system that refuses hard links says so in Devin Desktop words and changes no file', async (context) => {
  // Arrange
  const paths = await fixture(context)
  const window = await loadModule<typeof SkillDeploymentModule>(
    resolve(__dirname, '../cursorSkillDeployment.js'),
    {
      './constants': { ...constants },
      'node:fs/promises': {
        ...fileSystem,
        link: async () => {
          throw Object.assign(new Error('EPERM: refused, link'), {
            code: 'EPERM',
          })
        },
      },
    },
    { Error },
  )
  // Act
  const message = await window
    .deployDevinSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot)
    .then(
      () => 'installed',
      (error: Error) => error.message,
    )
  // Assert
  assert.equal(
    message,
    `Devin Desktop skill could not be installed: the file system refused to put Codebook's new file in place as ${paths.targetPath} (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await readdir(paths.skillFolder).catch(() => []), [])
})

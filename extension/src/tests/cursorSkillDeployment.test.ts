import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployCursorSkill, removeManagedCursorSkill, verifyManagedCursorSkill } from '../cursorSkillDeployment';

const INITIAL_SKILL = '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n';
const NEXT_SKILL = '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.1"\n---\n\nUse current state first.\n';

/** Creates isolated package, private receipt and user-home paths for filesystem lifecycle behavior. @example await fixture(t) // { extensionPath, storageRoot, homeRoot, targetPath } */
async function fixture(context: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-skill-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const extensionPath = join(directory, 'extension'), storageRoot = join(directory, 'storage'), homeRoot = join(directory, 'home');
  const sourceDirectory = join(extensionPath, 'skills', 'codebook'), targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md');
  await mkdir(sourceDirectory, { recursive: true }); await mkdir(storageRoot); await mkdir(homeRoot);
  await writeFile(join(sourceDirectory, 'SKILL.md'), INITIAL_SKILL);
  return { extensionPath, storageRoot, homeRoot, targetPath, sourcePath: join(sourceDirectory, 'SKILL.md') };
}

test('ordinary Cursor setup installs the packaged skill once and reconnect checks its exact owned bytes', async context => {
  // Arrange
  const paths = await fixture(context);
  // Act
  const [first, second] = await Promise.all([deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot),
    deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot)]);
  const verified = await verifyManagedCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  // Assert
  assert.deepEqual([first.status, second.status].sort(), ['current', 'installed']);
  assert.equal(first.version, '1.0.0'); assert.equal(verified.status, 'current');
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL);
  assert.equal(first.sha256, createHash('sha256').update(INITIAL_SKILL).digest('hex'));
});

test('setup refuses a pre-existing same-name Cursor skill without changing its content', async context => {
  // Arrange
  const paths = await fixture(context), custom = 'My own codebook skill';
  await mkdir(join(paths.homeRoot, '.cursor', 'skills', 'codebook'), { recursive: true });
  await writeFile(paths.targetPath, custom);
  // Act / Assert
  await assert.rejects(deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot), /already exists/);
  assert.equal(await readFile(paths.targetPath, 'utf8'), custom);
});

test('a later manual edit is preserved during upgrade and removal attempts', async context => {
  // Arrange
  const paths = await fixture(context);
  await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  await writeFile(paths.targetPath, 'Manually edited skill');
  await writeFile(paths.sourcePath, NEXT_SKILL);
  // Act / Assert
  await assert.rejects(deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot), /edited after setup/);
  await assert.rejects(removeManagedCursorSkill(paths.storageRoot, paths.homeRoot), /edited after setup/);
  assert.equal(await readFile(paths.targetPath, 'utf8'), 'Manually edited skill');
});

test('a same-byte manual replacement does not inherit the old file ownership receipt', async context => {
  // Arrange
  const paths = await fixture(context);
  await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  const replacement = join(paths.homeRoot, 'replacement.md');
  await writeFile(replacement, INITIAL_SKILL); await rename(replacement, paths.targetPath);
  // Act / Assert
  await assert.rejects(verifyManagedCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot), /missing, changed or outdated/);
  await assert.rejects(removeManagedCursorSkill(paths.storageRoot, paths.homeRoot), /replaced after setup/);
  assert.equal(await readFile(paths.targetPath, 'utf8'), INITIAL_SKILL);
});

test('an owned skill updates to the new package, then explicit removal and restore preserve its receipt', async context => {
  // Arrange
  const paths = await fixture(context), original = await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  await writeFile(paths.sourcePath, NEXT_SKILL);
  // Act
  const updated = await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  const removed = await removeManagedCursorSkill(paths.storageRoot, paths.homeRoot);
  await assert.rejects(lstat(join(paths.homeRoot, '.cursor', 'skills', 'codebook')), { code: 'ENOENT' });
  const restored = await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  // Assert
  assert.equal(updated.status, 'updated'); assert.equal(updated.version, '1.0.1');
  assert.equal(removed.status, 'removed'); assert.equal(restored.status, 'restored');
  assert.equal(await readFile(paths.targetPath, 'utf8'), NEXT_SKILL);
  assert.equal(await readFile(join(paths.storageRoot, 'cursor-skill', `${original.sha256}.SKILL.md`), 'utf8'), INITIAL_SKILL);
});

test('removing the managed skill leaves a user file in the same directory untouched', async context => {
  // Arrange
  const paths = await fixture(context), note = join(paths.homeRoot, '.cursor', 'skills', 'codebook', 'my-notes.txt');
  await deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot);
  await writeFile(note, 'Keep this note');
  // Act
  const removed = await removeManagedCursorSkill(paths.storageRoot, paths.homeRoot);
  // Assert
  assert.equal(removed.status, 'removed');
  assert.equal(await readFile(note, 'utf8'), 'Keep this note');
  await assert.rejects(lstat(paths.targetPath), { code: 'ENOENT' });
});

test('a symlinked Cursor skill directory cannot redirect installation to unrelated work', async context => {
  // Arrange
  const paths = await fixture(context), unrelated = join(paths.homeRoot, 'unrelated');
  await mkdir(join(paths.homeRoot, '.cursor', 'skills'), { recursive: true }); await mkdir(unrelated);
  await symlink(unrelated, join(paths.homeRoot, '.cursor', 'skills', 'codebook'));
  // Act / Assert
  await assert.rejects(deployCursorSkill(paths.extensionPath, paths.storageRoot, paths.homeRoot), /already exists/);
  assert.deepEqual(await readFile(paths.sourcePath, 'utf8'), INITIAL_SKILL);
});

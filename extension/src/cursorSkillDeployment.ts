import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_VERSION, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './constants';
import { atomicPrivateWrite } from './utils/atomicPrivateWrite';
import { withStorageLock } from './utils/withStorageLock';

const RECEIPT_LIMIT_BYTES = 16_384;
const SKILL_RELATIVE_PATH = join('skills', 'codebook', 'SKILL.md');

type SkillReceipt = {
  schemaVersion: 1;
  targetPath: string;
  skillSha256: string;
  skillVersion: string;
  extensionVersion: string;
  installed: boolean;
  device: number;
  inode: number;
};

export type CursorSkillResult = { status: 'installed' | 'updated' | 'restored' | 'current' | 'removed'; path: string; sha256: string; version: string };

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function inspectedPath(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path); } catch (error) { if (isMissing(error)) return undefined; throw error; }
}

async function regularFile(path: string): Promise<Buffer | undefined> {
  const status = await inspectedPath(path);
  if (!status) return undefined;
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Codebook will not change a non-regular skill file: ${path}`);
  return readFile(path);
}

async function ensureDirectory(path: string): Promise<void> {
  const existing = await inspectedPath(path);
  if (!existing) await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE });
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Codebook will not follow a non-directory skill path: ${path}`);
}

async function assertSkillParents(homeRoot: string): Promise<void> {
  for (const path of [join(homeRoot, '.cursor'), join(homeRoot, '.cursor', 'skills'), join(homeRoot, '.cursor', 'skills', 'codebook')]) {
    const status = await inspectedPath(path);
    if (!status?.isDirectory() || status.isSymbolicLink()) throw new Error(`Codebook will not follow a missing or redirected skill directory: ${path}`);
  }
}

function parseReceipt(value: unknown, targetPath: string): SkillReceipt {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('targetPath' in value) || value.targetPath !== targetPath || !('skillSha256' in value) || typeof value.skillSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.skillSha256) || !('skillVersion' in value) || typeof value.skillVersion !== 'string' ||
    !('extensionVersion' in value) || typeof value.extensionVersion !== 'string' || !('installed' in value) || typeof value.installed !== 'boolean' ||
    !('device' in value) || typeof value.device !== 'number' || !Number.isSafeInteger(value.device) ||
    !('inode' in value) || typeof value.inode !== 'number' || !Number.isSafeInteger(value.inode)) {
    throw new Error('Cursor skill ownership receipt is invalid; no skill file was changed.');
  }
  return { schemaVersion: 1, targetPath, skillSha256: value.skillSha256, skillVersion: value.skillVersion,
    extensionVersion: value.extensionVersion, installed: value.installed, device: value.device, inode: value.inode };
}

async function readReceipt(path: string, targetPath: string): Promise<SkillReceipt | undefined> {
  const bytes = await regularFile(path);
  return bytes ? parseReceipt(JSON.parse(bytes.toString('utf8')), targetPath) : undefined;
}

async function packageSkill(extensionPath: string): Promise<{ bytes: Buffer; version: string; sha256: string }> {
  const path = join(extensionPath, SKILL_RELATIVE_PATH), bytes = await regularFile(path);
  if (!bytes) throw new Error('This Codebook installation is missing its bundled skill. Reinstall the VSIX.');
  const version = /^---\nname: codebook\ndescription: [^\n]+\nmetadata:\n  version: "(\d+\.\d+\.\d+)"\n---\n/.exec(bytes.toString('utf8'))?.[1];
  if (!version) throw new Error('This Codebook installation has an invalid bundled skill. Reinstall the VSIX.');
  return { bytes, version, sha256: sha256(bytes) };
}

async function stageSkill(path: string, bytes: Buffer, replace: boolean): Promise<void> {
  const temporary = join(path, '..', `.codebook-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: PRIVATE_FILE_MODE });
    if (replace) await rename(temporary, path);
    else await link(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error; }); }
}

/** Installs or updates only a receipted user skill when Cursor setup is requested; another skill or later edit is preserved. @example await deployCursorSkill('/ext', '/private', '/home') */
export async function deployCursorSkill(extensionPath: string, storageRoot: string, homeRoot = homedir()): Promise<CursorSkillResult> {
  const targetDirectory = join(homeRoot, '.cursor', 'skills', 'codebook');
  const targetPath = join(targetDirectory, 'SKILL.md');
  const receiptDirectory = join(storageRoot, 'cursor-skill');
  const receiptPath = join(receiptDirectory, 'receipt.json');
  const packaged = await packageSkill(extensionPath);
  return withStorageLock(receiptDirectory, async () => {
    const receipt = await readReceipt(receiptPath, targetPath);
    const existingDirectory = await inspectedPath(targetDirectory);
    if (!receipt && existingDirectory) throw new Error('A codebook skill directory already exists in Cursor. Codebook left it untouched; resolve the name conflict before setup.');
    await ensureDirectory(join(homeRoot, '.cursor'));
    await ensureDirectory(join(homeRoot, '.cursor', 'skills'));
    await ensureDirectory(targetDirectory);
    const current = await regularFile(targetPath);
    if (!receipt && current) throw new Error('An existing codebook skill is not owned by this installation; no file was changed.');
    if (receipt && current) {
      const status = await lstat(targetPath);
      if (status.dev !== receipt.device || status.ino !== receipt.inode) throw new Error('The managed Cursor skill was replaced after setup; Codebook preserved it.');
    }
    if (receipt && current && sha256(current) !== receipt.skillSha256) throw new Error('The managed Cursor skill was edited after setup; Codebook preserved it. Restore or remove that edit manually before updating.');
    if (receipt && current && !receipt.installed) throw new Error('A codebook skill appeared after managed removal; Codebook preserved it.');
    if (receipt && current && receipt.skillSha256 === packaged.sha256) return { status: 'current', path: targetPath, sha256: packaged.sha256, version: packaged.version };
    // Preserve the old owned bytes for an interrupted upgrade without adopting arbitrary same-name content.
    if (current && receipt) {
      const backupPath = join(receiptDirectory, `${receipt.skillSha256}.SKILL.md`);
      const backup = await regularFile(backupPath);
      if (backup && sha256(backup) !== receipt.skillSha256) throw new Error('The previous managed skill backup differs from its receipt; no replacement was made.');
      if (!backup) await writeFile(backupPath, current, { flag: 'wx', mode: PRIVATE_FILE_MODE });
      if (sha256((await regularFile(targetPath)) ?? Buffer.alloc(0)) !== receipt.skillSha256) throw new Error('The Cursor skill changed during setup; no replacement was made.');
    }
    await stageSkill(targetPath, packaged.bytes, Boolean(current));
    const installedStatus = await lstat(targetPath);
    await atomicPrivateWrite(receiptPath, { schemaVersion: 1, targetPath, skillSha256: packaged.sha256,
      skillVersion: packaged.version, extensionVersion: EXTENSION_VERSION, installed: true,
      device: installedStatus.dev, inode: installedStatus.ino }, RECEIPT_LIMIT_BYTES);
    return { status: current ? 'updated' : receipt ? 'restored' : 'installed', path: targetPath, sha256: packaged.sha256, version: packaged.version };
  });
}

/** Checks a prior Cursor setup before reconnecting on editor restart; no file is repaired implicitly. @example await verifyManagedCursorSkill('/ext', '/private', '/home') */
export async function verifyManagedCursorSkill(extensionPath: string, storageRoot: string, homeRoot = homedir()): Promise<CursorSkillResult> {
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md');
  await assertSkillParents(homeRoot);
  const receipt = await readReceipt(join(storageRoot, 'cursor-skill', 'receipt.json'), targetPath);
  const packaged = await packageSkill(extensionPath), current = await regularFile(targetPath);
  const currentStatus = current ? await lstat(targetPath) : undefined;
  if (!receipt?.installed || !current || !currentStatus || currentStatus.dev !== receipt.device || currentStatus.ino !== receipt.inode ||
    sha256(current) !== receipt.skillSha256 || receipt.skillSha256 !== packaged.sha256) {
    throw new Error('Cursor skill is missing, changed or outdated. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.');
  }
  return { status: 'current', path: targetPath, sha256: packaged.sha256, version: packaged.version };
}

/** Removes only the exact receipted Cursor skill after an explicit user command; setup can restore it later. @example await removeManagedCursorSkill('/private', '/home') */
export async function removeManagedCursorSkill(storageRoot: string, homeRoot = homedir()): Promise<CursorSkillResult> {
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md');
  const receiptDirectory = join(storageRoot, 'cursor-skill'), receiptPath = join(receiptDirectory, 'receipt.json');
  return withStorageLock(receiptDirectory, async () => {
    await assertSkillParents(homeRoot);
    const receipt = await readReceipt(receiptPath, targetPath), current = await regularFile(targetPath);
    if (!receipt?.installed || !current) throw new Error('No installed Codebook-owned Cursor skill was found; no file was changed.');
    const status = await lstat(targetPath);
    if (status.dev !== receipt.device || status.ino !== receipt.inode) throw new Error('The Cursor skill was replaced after setup; Codebook preserved it.');
    if (sha256(current) !== receipt.skillSha256) throw new Error('The Cursor skill was edited after setup; Codebook preserved it.');
    await unlink(targetPath);
    // Remove only an empty Codebook directory; leave any user-added files in place.
    await rmdir(join(homeRoot, '.cursor', 'skills', 'codebook')).catch(error => {
      if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error;
    });
    await atomicPrivateWrite(receiptPath, { ...receipt, installed: false }, RECEIPT_LIMIT_BYTES);
    return { status: 'removed', path: targetPath, sha256: receipt.skillSha256, version: receipt.skillVersion };
  });
}

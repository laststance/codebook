import { createHash, randomUUID } from 'node:crypto';
import { constants as fileFlags } from 'node:fs';
import { link, lstat, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CURSOR_MCP_CATALOG_LOCK_RETRIES, CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS, CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES, CURSOR_MCP_CATALOG_REFRESH_STEP_MS, PRIVATE_FILE_MODE } from '../constants';
import { atomicPrivateWrite } from './atomicPrivateWrite';
import { withStorageLock } from './withStorageLock';

const EMPTY_MCP_CONFIG = '{"mcpServers":{}}\n';
const EMPTY_MCP_CONFIG_SHA256 = createHash('sha256').update(EMPTY_MCP_CONFIG).digest('hex');

type CatalogReceipt = { schemaVersion: 1; targetPath: string; sha256: string; device: number; inode: number; installed: boolean; retiredPath?: string };
type PendingRemoval = { schemaVersion: 1; owner: CatalogReceipt; retiredPath: string };
export type CursorCatalogCleanup = 'removed' | 'preserved' | 'not-owned';

/** Recognizes an absent path during catalog reads without hiding access failures. @example isMissing(error) */
function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

/** Rejects a redirected Cursor settings parent before setup or cleanup touches its config. @example await regularDirectory('/home/user/.cursor') */
async function regularDirectory(path: string): Promise<void> {
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.');
}

/** Reads a bounded private journal without following a replaced record path. @example await privateJson('/private/receipt.json') */
async function privateJson(path: string): Promise<unknown | undefined> {
  let handle;
  try { handle = await open(path, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW); }
  catch (error) { if (isMissing(error)) return undefined; throw error; }
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES) throw new Error('Cursor MCP catalog ownership record is invalid.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

/** Validates the exact config identity before {@link removeOwnedCursorMcpCatalog} can retire it. @example parseReceipt(record, '/home/user/.cursor/mcp.json') */
function parseReceipt(value: unknown, targetPath: string): CatalogReceipt {
  const retiredPath = typeof value === 'object' && value !== null && 'retiredPath' in value ? value.retiredPath : undefined;
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('targetPath' in value) || value.targetPath !== targetPath || !('sha256' in value) || value.sha256 !== EMPTY_MCP_CONFIG_SHA256 ||
    !('device' in value) || typeof value.device !== 'number' || !Number.isSafeInteger(value.device) || value.device < 0 ||
    !('inode' in value) || typeof value.inode !== 'number' || !Number.isSafeInteger(value.inode) || value.inode < 0 ||
    !('installed' in value) || typeof value.installed !== 'boolean' ||
    (retiredPath !== undefined && typeof retiredPath !== 'string')) throw new Error('Cursor MCP catalog ownership record is invalid; Codebook preserved the config.');
  return { schemaVersion: 1, targetPath, sha256: value.sha256, device: value.device, inode: value.inode,
    installed: value.installed, ...(retiredPath !== undefined ? { retiredPath } : {}) };
}

/** Matches inode and bytes through one no-follow handle before recovery or removal, tolerating volume device renumbering. @example await ownedFile('/home/user/.cursor/mcp.json', receipt) */
async function ownedFile(path: string, owner: CatalogReceipt): Promise<boolean> {
  let handle;
  try { handle = await open(path, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW); }
  catch (error) { if (isMissing(error) || (error instanceof Error && 'code' in error && error.code === 'ELOOP')) return false; throw error; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.ino !== owner.inode) return false;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    return after.dev === before.dev && after.ino === before.ino &&
      createHash('sha256').update(bytes).digest('hex') === owner.sha256;
  } finally { await handle.close(); }
}

/** Completes a journaled retirement before {@link refreshCursorMcpCatalog} can create another config. @example await recoverRemoval(pending, receipt, target, storage) */
async function recoverRemoval(pendingPath: string, receiptPath: string, targetPath: string, storageDirectory: string): Promise<CursorCatalogCleanup | undefined> {
  const record = await privateJson(pendingPath);
  if (record === undefined) return undefined;
  if (typeof record !== 'object' || record === null || !('schemaVersion' in record) || record.schemaVersion !== 1 ||
    !('owner' in record) || !('retiredPath' in record) || typeof record.retiredPath !== 'string' ||
    dirname(record.retiredPath) !== storageDirectory ||
    !/^retired-[a-f0-9-]+\.mcp\.json$/.test(basename(record.retiredPath))) throw new Error('Cursor MCP catalog removal record is invalid; Codebook preserved the config.');
  const owner = parseReceipt(record.owner, targetPath);
  if (await ownedFile(record.retiredPath, owner)) {
    await atomicPrivateWrite(receiptPath, { ...owner, installed: false, retiredPath: record.retiredPath }, CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES);
    await unlink(pendingPath);
    return 'removed';
  }
  if (!await ownedFile(targetPath, owner)) throw new Error('Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record.');
  await unlink(pendingPath);
  return undefined;
}

/** Waits briefly for another active Cursor window's catalog writer without displacing an interrupted lock. @example await withCatalogLockRetry(() => withStorageLock('/private', update)) */
async function withCatalogLockRetry(operation: () => Promise<void>): Promise<void> {
  for (let retry = 0; ; retry += 1) {
    try { await operation(); return; }
    catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST') || retry >= CURSOR_MCP_CATALOG_LOCK_RETRIES) throw error;
      await delay(CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS);
    }
  }
}

/** Wakes Cursor's MCP catalog and receipts only an empty file Codebook creates during setup. @example await refreshCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function refreshCursorMcpCatalog(storageRoot: string, cursorDirectory = join(homedir(), '.cursor')): Promise<void> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog');
  await withCatalogLockRetry(() => withStorageLock(storageDirectory, async () => {
    await regularDirectory(cursorDirectory);
    const targetPath = join(cursorDirectory, 'mcp.json'), receiptPath = join(storageDirectory, 'receipt.json');
    await recoverRemoval(join(storageDirectory, 'pending-removal.json'), receiptPath, targetPath, storageDirectory);
    const previous = await privateJson(receiptPath);
    if (previous !== undefined) parseReceipt(previous, targetPath);
    let handle;
    let createdConfig = false;
    try { handle = await open(targetPath, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW); }
    catch (error) {
      if (!isMissing(error)) throw new Error('Cursor MCP config cannot be refreshed without following a redirected or inaccessible file.', { cause: error });
      try {
        handle = await open(targetPath, fileFlags.O_CREAT | fileFlags.O_EXCL | fileFlags.O_NOFOLLOW | fileFlags.O_RDWR, PRIVATE_FILE_MODE);
        createdConfig = true;
      } catch (createError) {
        if (!(createError instanceof Error && 'code' in createError && createError.code === 'EEXIST')) throw createError;
        handle = await open(targetPath, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW);
      }
    }
    try {
      // The private receipt binds only the exact empty file Codebook just created, never an existing user config.
      if (createdConfig) {
        await handle.writeFile(EMPTY_MCP_CONFIG);
        await handle.sync();
        const created = await handle.stat();
        await atomicPrivateWrite(receiptPath, { schemaVersion: 1, targetPath, sha256: EMPTY_MCP_CONFIG_SHA256,
          device: created.dev, inode: created.ino, installed: true }, CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES);
      }
      const status = await handle.stat();
      if (!status.isFile()) throw new Error('Cursor MCP config is not a regular file; Codebook left its settings unchanged.');
      if (status.size === 0) throw new Error('Cursor MCP config is empty; Codebook preserved it. Inspect this file before retrying setup.');
      // Cursor 3.21.16 may connect an extension server without publishing it to Agent until this file watcher fires.
      await handle.utimes(status.atime, new Date(Math.max(Date.now(), status.mtimeMs + CURSOR_MCP_CATALOG_REFRESH_STEP_MS)));
    } finally { await handle.close(); }
  }));
}

/** Retires only Codebook's unchanged empty Cursor catalog after explicit managed-skill removal. @example await removeOwnedCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function removeOwnedCursorMcpCatalog(storageRoot: string, cursorDirectory = join(homedir(), '.cursor')): Promise<CursorCatalogCleanup> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog');
  return withStorageLock(storageDirectory, async () => {
    await regularDirectory(cursorDirectory);
    const targetPath = join(cursorDirectory, 'mcp.json'), receiptPath = join(storageDirectory, 'receipt.json');
    const pendingPath = join(storageDirectory, 'pending-removal.json');
    const recovered = await recoverRemoval(pendingPath, receiptPath, targetPath, storageDirectory);
    if (recovered) return recovered;
    const rawReceipt = await privateJson(receiptPath);
    if (rawReceipt === undefined) return 'not-owned';
    const owner = parseReceipt(rawReceipt, targetPath);
    if (!owner.installed || !await ownedFile(targetPath, owner)) return 'preserved';
    // Retain the actual file privately; a concurrent edit or replacement must never be unlinked after a stale check.
    if ((await lstat(cursorDirectory)).dev !== (await lstat(storageDirectory)).dev) return 'preserved';
    const retiredPath = join(storageDirectory, `retired-${randomUUID()}.mcp.json`);
    const pending: PendingRemoval = { schemaVersion: 1, owner, retiredPath };
    await atomicPrivateWrite(pendingPath, pending, CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES);
    await rename(targetPath, retiredPath);
    if (!await ownedFile(retiredPath, owner)) {
      await link(retiredPath, targetPath).catch(() => undefined);
      throw new Error('Cursor MCP catalog changed during cleanup; Codebook retained the actual file and recovery record.');
    }
    await atomicPrivateWrite(receiptPath, { ...owner, installed: false, retiredPath }, CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES);
    await unlink(pendingPath);
    return 'removed';
  });
}

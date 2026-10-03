import { createHash, randomUUID } from 'node:crypto'
import { constants as fileFlags } from 'node:fs'
import { link, lstat, open, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  CURSOR_MCP_CATALOG_LOCK_RETRIES,
  CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS,
  CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  CURSOR_MCP_CATALOG_REFRESH_STEP_MS,
  PRIVATE_FILE_MODE,
} from '../constants'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { withStorageLock } from './withStorageLock'

const EMPTY_MCP_CONFIG = '{"mcpServers":{}}\n'
const EMPTY_MCP_CONFIG_SHA256 = createHash('sha256')
  .update(EMPTY_MCP_CONFIG)
  .digest('hex')

type CatalogReceipt = {
  schemaVersion: 1
  targetPath: string
  sha256: string
  device: number
  inode: number
  installed: boolean
  retiredPath?: string
  refreshId?: string
}
type PendingCreation = {
  schemaVersion: 1
  owner: CatalogReceipt
  stagedPath: string
}
type PendingRemoval = {
  schemaVersion: 1
  owner: CatalogReceipt
  retiredPath: string
}
export type CursorCatalogCleanup = 'removed' | 'preserved' | 'not-owned'

/** Recognizes an absent path during catalog reads without hiding access failures. @example isMissing(error) */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Rejects a redirected Cursor settings parent before setup or cleanup touches its config. @example await regularDirectory('/home/user/.cursor') */
async function regularDirectory(path: string): Promise<void> {
  const status = await lstat(path)
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error(
      'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.',
    )
}

/** Reads a bounded private journal without following a replaced record path. @example await privateJson('/private/receipt.json') */
async function privateJson(path: string): Promise<unknown | undefined> {
  let handle
  try {
    handle = await open(path, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  try {
    const status = await handle.stat()
    if (
      !status.isFile() ||
      status.size > CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES
    )
      throw new Error('Cursor MCP catalog ownership record is invalid.')
    return JSON.parse(await handle.readFile('utf8'))
  } finally {
    await handle.close()
  }
}

/** Validates the exact config identity before {@link removeOwnedCursorMcpCatalog} can retire it. @example parseReceipt(record, '/home/user/.cursor/mcp.json') */
function parseReceipt(value: unknown, targetPath: string): CatalogReceipt {
  const retiredPath =
    typeof value === 'object' && value !== null && 'retiredPath' in value
      ? value.retiredPath
      : undefined
  const refreshId =
    typeof value === 'object' && value !== null && 'refreshId' in value
      ? value.refreshId
      : undefined
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('sha256' in value) ||
    value.sha256 !== EMPTY_MCP_CONFIG_SHA256 ||
    !('device' in value) ||
    typeof value.device !== 'number' ||
    !Number.isSafeInteger(value.device) ||
    value.device < 0 ||
    !('inode' in value) ||
    typeof value.inode !== 'number' ||
    !Number.isSafeInteger(value.inode) ||
    value.inode < 0 ||
    !('installed' in value) ||
    typeof value.installed !== 'boolean' ||
    (retiredPath !== undefined && typeof retiredPath !== 'string') ||
    (refreshId !== undefined &&
      (typeof refreshId !== 'string' || !/^[a-f0-9-]{36}$/.test(refreshId)))
  )
    throw new Error(
      'Cursor MCP catalog ownership record is invalid; Codebook preserved the config.',
    )
  return {
    schemaVersion: 1,
    targetPath,
    sha256: value.sha256,
    device: value.device,
    inode: value.inode,
    installed: value.installed,
    ...(retiredPath !== undefined ? { retiredPath } : {}),
    ...(refreshId !== undefined ? { refreshId } : {}),
  }
}

/** Matches inode and bytes through one no-follow handle before recovery or removal, tolerating volume device renumbering. @example await ownedFile('/home/user/.cursor/mcp.json', receipt) */
async function ownedFile(
  path: string,
  owner: CatalogReceipt,
): Promise<boolean> {
  let handle
  try {
    handle = await open(path, fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW)
  } catch (error) {
    if (
      isMissing(error) ||
      (error instanceof Error && 'code' in error && error.code === 'ELOOP')
    )
      return false
    throw error
  }
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.ino !== owner.inode) return false
    const bytes = await handle.readFile()
    const after = await handle.stat()
    return (
      after.dev === before.dev &&
      after.ino === before.ino &&
      createHash('sha256').update(bytes).digest('hex') === owner.sha256
    )
  } finally {
    await handle.close()
  }
}

/** Advances a verified empty config's private generation so a later cleanup cannot retire a newer window's refresh. @example await advanceOwnedRefreshId(receiptPath, targetPath) */
async function advanceOwnedRefreshId(
  receiptPath: string,
  targetPath: string,
): Promise<string | undefined> {
  const rawOwner = await privateJson(receiptPath)
  if (rawOwner === undefined) return undefined
  const owner = parseReceipt(rawOwner, targetPath)
  if (!owner.installed || !(await ownedFile(targetPath, owner)))
    return undefined
  const refreshId = randomUUID()
  await atomicPrivateWrite(
    receiptPath,
    { ...owner, refreshId },
    CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  )
  return refreshId
}

/** Completes ownership after an atomic config publication, or discards only its verified unpublished staging file. @example await recoverCreation(pending, receipt, target, cursorDirectory) */
async function recoverCreation(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  cursorDirectory: string,
): Promise<void> {
  const record = await privateJson(pendingPath)
  if (record === undefined) return
  if (
    typeof record !== 'object' ||
    record === null ||
    !('schemaVersion' in record) ||
    record.schemaVersion !== 1 ||
    !('owner' in record) ||
    !('stagedPath' in record) ||
    typeof record.stagedPath !== 'string' ||
    dirname(record.stagedPath) !== cursorDirectory ||
    !/^\.codebook-[a-f0-9-]+\.mcp\.json$/.test(basename(record.stagedPath))
  )
    throw new Error(
      'Cursor MCP catalog creation record is invalid; Codebook preserved the config.',
    )
  const owner = parseReceipt(record.owner, targetPath)
  if (!owner.installed || owner.retiredPath !== undefined)
    throw new Error(
      'Cursor MCP catalog creation record is invalid; Codebook preserved the config.',
    )
  const published = await ownedFile(targetPath, owner),
    staged = await ownedFile(record.stagedPath, owner)
  if (published)
    await atomicPrivateWrite(
      receiptPath,
      owner,
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
  if (staged) await unlink(record.stagedPath)
  // A changed target remains user-owned; only the exact staged inode is discarded.
  await unlink(pendingPath)
}

/** Completes a journaled retirement before {@link refreshCursorMcpCatalog} can create another config. @example await recoverRemoval(pending, receipt, target, storage) */
async function recoverRemoval(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  storageDirectory: string,
): Promise<CursorCatalogCleanup | undefined> {
  const record = await privateJson(pendingPath)
  if (record === undefined) return undefined
  if (
    typeof record !== 'object' ||
    record === null ||
    !('schemaVersion' in record) ||
    record.schemaVersion !== 1 ||
    !('owner' in record) ||
    !('retiredPath' in record) ||
    typeof record.retiredPath !== 'string' ||
    dirname(record.retiredPath) !== storageDirectory ||
    !/^retired-[a-f0-9-]+\.mcp\.json$/.test(basename(record.retiredPath))
  )
    throw new Error(
      'Cursor MCP catalog removal record is invalid; Codebook preserved the config.',
    )
  const owner = parseReceipt(record.owner, targetPath)
  if (await ownedFile(record.retiredPath, owner)) {
    await atomicPrivateWrite(
      receiptPath,
      { ...owner, installed: false, retiredPath: record.retiredPath },
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
    await unlink(pendingPath)
    return 'removed'
  }
  if (!(await ownedFile(targetPath, owner)))
    throw new Error(
      'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record.',
    )
  await unlink(pendingPath)
  return undefined
}

/** Waits briefly for another active Cursor window's catalog writer, also one that is taking a stale lock over; the retries displace no lock themselves. {@link withStorageLock} takes over a lock whose writer process is gone from this machine, and any other lock that stays through the retries is reported. @example await withCatalogLockRetry(() => withStorageLock('/private', update)) */
async function withCatalogLockRetry<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await operation()
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      if (
        !(
          cause instanceof Error &&
          'code' in cause &&
          cause.code === 'EEXIST'
        ) ||
        retry >= CURSOR_MCP_CATALOG_LOCK_RETRIES
      )
        throw error
      await delay(CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS)
    }
  }
}

/** Wakes Cursor's MCP catalog and returns the generation of an unchanged Codebook-owned empty file. @example await refreshCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function refreshCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
): Promise<string | undefined> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      const pendingCreationPath = join(
        storageDirectory,
        'pending-creation.json',
      )
      await recoverCreation(
        pendingCreationPath,
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      await recoverRemoval(
        join(storageDirectory, 'pending-removal.json'),
        receiptPath,
        targetPath,
        storageDirectory,
      )
      const previous = await privateJson(receiptPath)
      if (previous !== undefined) parseReceipt(previous, targetPath)
      let handle
      try {
        handle = await open(
          targetPath,
          fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW,
        )
      } catch (error) {
        if (!isMissing(error))
          throw new Error(
            'Cursor MCP config cannot be refreshed without following a redirected or inaccessible file.',
            { cause: error },
          )
        const stagedPath = join(
          cursorDirectory,
          `.codebook-${randomUUID()}.mcp.json`,
        )
        const stagedHandle = await open(
          stagedPath,
          fileFlags.O_CREAT |
            fileFlags.O_EXCL |
            fileFlags.O_NOFOLLOW |
            fileFlags.O_RDWR,
          PRIVATE_FILE_MODE,
        )
        let staged
        try {
          await stagedHandle.writeFile(EMPTY_MCP_CONFIG)
          await stagedHandle.sync()
          staged = await stagedHandle.stat()
        } finally {
          await stagedHandle.close()
        }
        const owner: CatalogReceipt = {
          schemaVersion: 1,
          targetPath,
          sha256: EMPTY_MCP_CONFIG_SHA256,
          device: staged.dev,
          inode: staged.ino,
          installed: true,
        }
        const pending: PendingCreation = { schemaVersion: 1, owner, stagedPath }
        await atomicPrivateWrite(
          pendingCreationPath,
          pending,
          CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
        )
        try {
          await link(stagedPath, targetPath)
        } catch (createError) {
          if (!(
            createError instanceof Error &&
            'code' in createError &&
            createError.code === 'EEXIST'
          ))
            throw createError
          await recoverCreation(
            pendingCreationPath,
            receiptPath,
            targetPath,
            cursorDirectory,
          )
          handle = await open(
            targetPath,
            fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW,
          )
        }
        if (!handle) {
          if (!(await ownedFile(targetPath, owner)))
            throw new Error(
              'Cursor MCP config changed during publication; Codebook preserved it and its recovery record.',
            )
          await atomicPrivateWrite(
            receiptPath,
            owner,
            CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
          )
          await unlink(stagedPath)
          await unlink(pendingCreationPath)
          handle = await open(
            targetPath,
            fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW,
          )
        }
      }
      try {
        const status = await handle.stat()
        if (!status.isFile())
          throw new Error(
            'Cursor MCP config is not a regular file; Codebook left its settings unchanged.',
          )
        if (status.size === 0)
          throw new Error(
            'Cursor MCP config is empty; Codebook preserved it. Inspect this file before retrying setup.',
          )
        // Cursor 3.21.16 may connect an extension server without publishing it to Agent until this file watcher fires.
        await handle.utimes(
          status.atime,
          new Date(
            Math.max(
              Date.now(),
              status.mtimeMs + CURSOR_MCP_CATALOG_REFRESH_STEP_MS,
            ),
          ),
        )
        return advanceOwnedRefreshId(receiptPath, targetPath)
      } finally {
        await handle.close()
      }
    }),
  )
}

/** Reserves the current owned catalog generation before explicit skill removal without creating or touching a user config. @example await captureOwnedCursorMcpCatalogGeneration('/private') */
export async function captureOwnedCursorMcpCatalogGeneration(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
): Promise<string | undefined> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      await recoverCreation(
        join(storageDirectory, 'pending-creation.json'),
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      await recoverRemoval(
        join(storageDirectory, 'pending-removal.json'),
        receiptPath,
        targetPath,
        storageDirectory,
      )
      return advanceOwnedRefreshId(receiptPath, targetPath)
    }),
  )
}

/** Retires only Codebook's unchanged empty Cursor catalog, optionally limited to one refresh generation. @example await removeOwnedCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function removeOwnedCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
  expectedRefreshId?: string,
): Promise<CursorCatalogCleanup> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      const pendingPath = join(storageDirectory, 'pending-removal.json')
      await recoverCreation(
        join(storageDirectory, 'pending-creation.json'),
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      const recovered = await recoverRemoval(
        pendingPath,
        receiptPath,
        targetPath,
        storageDirectory,
      )
      if (recovered) return recovered
      const rawReceipt = await privateJson(receiptPath)
      if (rawReceipt === undefined) return 'not-owned'
      const owner = parseReceipt(rawReceipt, targetPath)
      if (
        expectedRefreshId !== undefined &&
        owner.refreshId !== expectedRefreshId
      )
        return 'preserved'
      if (!owner.installed || !(await ownedFile(targetPath, owner)))
        return 'preserved'
      // Retain the actual file privately; a concurrent edit or replacement must never be unlinked after a stale check.
      if (
        (await lstat(cursorDirectory)).dev !==
        (await lstat(storageDirectory)).dev
      )
        return 'preserved'
      const retiredPath = join(
        storageDirectory,
        `retired-${randomUUID()}.mcp.json`,
      )
      const pending: PendingRemoval = { schemaVersion: 1, owner, retiredPath }
      await atomicPrivateWrite(
        pendingPath,
        pending,
        CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
      )
      await rename(targetPath, retiredPath)
      if (!(await ownedFile(retiredPath, owner))) {
        await link(retiredPath, targetPath).catch(() => undefined)
        throw new Error(
          'Cursor MCP catalog changed during cleanup; Codebook retained the actual file and recovery record.',
        )
      }
      await atomicPrivateWrite(
        receiptPath,
        { ...owner, installed: false, retiredPath },
        CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
      )
      await unlink(pendingPath)
      return 'removed'
    }),
  )
}

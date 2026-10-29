import { createHash, createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { StudyError } from '../errors'

/** What a run needs from an extension's manifest.json. */
export interface ExtensionManifest {
  name: string
  permissions: readonly string[]
  hostPermissions: readonly string[]
  /** `action.default_popup`, relative to the extension root without a leading `./` or `/`. */
  popupPath?: string
  /** `background.service_worker`, relative to the extension root. */
  workerPath?: string
  /** `module` when `background.type` is `module`, else `classic`. */
  workerType: 'classic' | 'module'
  /** The manifest's `key`, validated as a public key. */
  key?: string
  /** SHA-256 of the manifest's bytes (ER20). */
  sha256: string
}

const MANIFEST_UNREADABLE_MESSAGE = 'The manifest.json could not be read.'

/** Narrows a parsed JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keeps only the strings of a manifest list; anything else reads as an empty list. */
function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Strips a leading `./` or `/` so a manifest path reads relative to the extension root. */
function relativeToRoot(manifestPath: string): string {
  return manifestPath.replace(/^(?:\.\/|\/)+/, '')
}

/** Reads an optional manifest path field: a non-empty string or nothing. */
function optionalPath(value: unknown): string | undefined {
  return typeof value === 'string' && value !== ''
    ? relativeToRoot(value)
    : undefined
}

/**
 * Checks that a manifest `key` decodes to a public key, throwing the refusal the table words.
 * @throws `MANIFEST_UNREADABLE` when the key is not a string or not a DER public key.
 */
function validatedKey(key: unknown): string | undefined {
  if (key === undefined) return undefined
  try {
    if (typeof key !== 'string') throw new TypeError('key is not a string')
    createPublicKey({
      key: Buffer.from(key, 'base64'),
      format: 'der',
      type: 'spki',
    })
    return key
  } catch {
    throw new StudyError(
      'MANIFEST_UNREADABLE',
      'The manifest key is not a valid public key.',
    )
  }
}

/**
 * Reads and checks an extension root's manifest.json before a run launches anything, and extracts what the run needs.
 * Called by {@link resolveChromeExtensionRun} after the tree walk; checks that the file reads as JSON, is Manifest V3 and carries a valid `key` when present.
 * @param extensionRoot - The extension root's canonical path.
 * @returns The manifest fields the run uses, with the SHA-256 of the file's bytes.
 * @throws `MANIFEST_UNREADABLE` for a missing, malformed or non-object manifest or an invalid key; `MANIFEST_NOT_V3` for another `manifest_version`.
 * @example
 * await readExtensionManifest('/repo/ext') // => { name: 'My Ext', permissions: ['storage'], popupPath: 'popup/popup.html', workerType: 'classic', … }
 */
export async function readExtensionManifest(
  extensionRoot: string,
): Promise<ExtensionManifest> {
  const manifestBytes = await readFile(
    join(extensionRoot, 'manifest.json'),
  ).catch(() => undefined)
  if (manifestBytes === undefined)
    throw new StudyError('MANIFEST_UNREADABLE', MANIFEST_UNREADABLE_MESSAGE)
  let manifest: unknown
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new StudyError('MANIFEST_UNREADABLE', MANIFEST_UNREADABLE_MESSAGE)
  }
  if (!isRecord(manifest))
    throw new StudyError('MANIFEST_UNREADABLE', MANIFEST_UNREADABLE_MESSAGE)
  // The version is checked before the name, so a version 2 manifest without a name is still MANIFEST_NOT_V3.
  if (manifest.manifest_version !== 3)
    throw new StudyError(
      'MANIFEST_NOT_V3',
      'The extension root needs a Manifest V3 manifest.json.',
      'The extension root needs a Manifest V3 manifest.json. Set "manifest_version": 3 in manifest.json.',
    )
  if (typeof manifest.name !== 'string')
    throw new StudyError('MANIFEST_UNREADABLE', MANIFEST_UNREADABLE_MESSAGE)
  const action = isRecord(manifest.action) ? manifest.action : {}
  const background = isRecord(manifest.background) ? manifest.background : {}
  return {
    name: manifest.name,
    permissions: stringList(manifest.permissions),
    hostPermissions: stringList(manifest.host_permissions),
    popupPath: optionalPath(action.default_popup),
    workerPath: optionalPath(background.service_worker),
    workerType: background.type === 'module' ? 'module' : 'classic',
    key: validatedKey(manifest.key),
    sha256: createHash('sha256').update(manifestBytes).digest('hex'),
  }
}

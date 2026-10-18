import { MACHINE_KEY_HEX_LENGTH } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Names a machine by two digests, so that a record which must not name the computer (one written into a learner's project folder) can still be recognised by the machine that wrote it; called by {@link currentStorageOwner} for every identity, and compared by {@link isSameStorageMachine}.
 *
 * Why two: `machineKey` follows the editor's machine id, which stays the same when the host name follows the network, and `hostKey` follows the host name, which VS Code and Cursor on one computer share while their machine ids differ.
 * Limits: two computers with one host name have one `hostKey`, and look like one machine unless their `machineKey`s and their boot ids both differ ({@link isSameStorageMachine}). A digest is a pseudonym, not a secret: it can lie in a file a commit publishes, and the digest of a common host name can be found by trying names.
 *
 * @param editorMachineId - The editor's id of this machine that {@link useEditorMachineId} accepted; `undefined` in a remote window, a plain Node process and an editor that answers the placeholder.
 * @param hostName - The machine's host name.
 * @returns `machineKey`, the first {@link MACHINE_KEY_HEX_LENGTH} hex characters of the SHA-256 of the editor's machine id, or of the host name where there is none; and `hostKey`, the same digest of the host name.
 * @example
 * deriveMachineKeys('machine-a', 'workstation') // => { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' }
 * deriveMachineKeys(undefined, 'workstation')   // => { machineKey: 'd195d36bd79da7df', hostKey: 'd195d36bd79da7df' }
 */
export function deriveMachineKeys(
  editorMachineId: string | undefined,
  hostName: string,
): Required<Pick<StorageOwnerIdentity, 'machineKey' | 'hostKey'>> {
  const hostKey = sha256(hostName).slice(0, MACHINE_KEY_HEX_LENGTH)
  return {
    machineKey:
      editorMachineId === undefined
        ? hostKey
        : sha256(editorMachineId).slice(0, MACHINE_KEY_HEX_LENGTH),
    hostKey,
  }
}

import { hostname } from 'node:os'

import { EDITOR_MACHINE_ID_PLACEHOLDER } from '../constants'

import { readBootIdentity } from './readBootIdentity'
import type { BootIdentity, StorageOwnerIdentity } from './readRecordedOwner'

/** The editor's id of this machine, once {@link useEditorMachineId} accepted one. */
let editorMachineId: string | undefined

/** The boot of this process, read once: it cannot change while the process lives, and a boot time computed again would move with the clock. */
let bootIdentity: Promise<BootIdentity> | undefined

/**
 * Gives the storage utilities the editor's id of this machine, which stays the same when the host name follows the network; called once by {@link activate}, before anything takes a storage lock.
 * An id is used only where it names the machine whose processes this extension host can probe. In a remote window it names the computer the editor's interface runs on, so two hosts that share a home directory would count as one machine; and an editor without its telemetry service answers {@link EDITOR_MACHINE_ID_PLACEHOLDER} on every computer. In both cases the host name identifies the machine, as it does in a plain Node process.
 * @param machineId - `vscode.env.machineId`; `undefined` where the editor gives none.
 * @param remoteName - `vscode.env.remoteName`; `undefined` in a local window.
 * @example
 * useEditorMachineId(vscode.env.machineId, vscode.env.remoteName)
 */
export function useEditorMachineId(
  machineId: string | undefined,
  remoteName: string | undefined,
): void {
  editorMachineId =
    machineId && !remoteName && machineId !== EDITOR_MACHINE_ID_PLACEHOLDER
      ? machineId
      : undefined
}

/**
 * Names the machine and the boot this process runs under, as it writes them into every storage lock, takeover claim and connection descriptor and judges other owners by; the default identity of {@link withStorageLock} and {@link evidenceInUseElsewhere}, and what {@link activate} adds to its connection descriptor.
 * @returns The host name, the editor's machine id when {@link useEditorMachineId} accepted one, and the boot from {@link readBootIdentity}.
 * @example
 * await currentStorageOwner() // => { hostname: 'workstation', machineId: 'f3a1…', boot: { id: '0c1d…' } }
 */
export async function currentStorageOwner(): Promise<StorageOwnerIdentity> {
  bootIdentity ??= readBootIdentity()
  return {
    hostname: hostname(),
    machineId: editorMachineId,
    boot: await bootIdentity,
  }
}

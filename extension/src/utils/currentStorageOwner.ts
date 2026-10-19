import { hostname } from 'node:os'

import { EDITOR_MACHINE_ID_PLACEHOLDER } from '../constants'

import { deriveMachineKeys } from './deriveMachineKeys'
import { readBootIdentity, type BootIdentityInputs } from './readBootIdentity'
import { readProcessStart, type ProcessStartInputs } from './readProcessStart'
import type { BootIdentity, StorageOwnerIdentity } from './readRecordedOwner'

/** The editor's id of this machine, once {@link useEditorMachineId} accepted one. */
let editorMachineId: string | undefined

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
 * Leaves a computed boot time out of what this process records while its own start is unknown; called by {@link currentStorageOwner}.
 * A record without a start is judged by its boot, and a boot time moves with every correction of the clock, which would make a live owner look like one of an earlier boot. A boot's id, which no clock moves (the kernel's on Linux, the boot session on macOS), stays.
 * @param boot - The boot {@link readBootIdentity} read now.
 * @param processStart - This process's start; `undefined` while it cannot be read.
 * @returns The boot while the start is known; while it is unknown, the boot's id alone, or `undefined` for a boot time alone.
 * @example
 * recordedBoot({ startedAtMs: 1_790_000_000_000 }, 'win:2026-10-05T09:12:33.1234567Z') // => { startedAtMs: 1_790_000_000_000 }
 * recordedBoot({ startedAtMs: 1_790_000_000_000 }, undefined)                          // => undefined
 * recordedBoot({ id: '8C9E…', startedAtMs: 1_790_000_000_000 }, undefined)             // => { id: '8C9E…' }
 */
function recordedBoot(
  boot: BootIdentity,
  processStart: string | undefined,
): BootIdentity | undefined {
  if (processStart !== undefined) return boot
  return 'id' in boot ? { id: boot.id } : undefined
}

/**
 * Names the machine, the boot and the process start this process runs under, as it writes them into every storage lock, takeover claim, connection descriptor and profile marker and judges other owners by; the default identity of {@link withStorageLock} and {@link evidenceInUseElsewhere}, what {@link activate} adds to its connection descriptor, and what {@link activate} calls once at its start so that the first storage lock does not wait for the read of the process start.
 * The process start is read once and kept, and a read that failed is made again after {@link PROCESS_START_RETRY_AFTER_FAILURE_MS} ({@link readProcessStart}); it is what a window of this build judges another by, and no clock moves it. The exact macOS boot id is kept after a successful read ({@link readBootIdentity}); the computed boot time is refreshed at every call. A clock correction moves that estimate, so an old estimate would keep disagreeing with one a later window computes. It is recorded for the windows of 0.2.29.0, which judge by it, and serves this process for records without a start.
 * @param startInputs - What the process start is read with; the real system unless a test names its own ({@link ProcessStartInputs}).
 * @param bootInputs - What the boot is read with on macOS; the real system unless a test names its own ({@link BootIdentityInputs}).
 * @returns The host name, the editor's machine id when {@link useEditorMachineId} accepted one, the machine's two pseudonyms ({@link deriveMachineKeys}), the boot {@link readBootIdentity} reads now, and this process's start. While the start cannot be read it is absent, and so is a boot that is a computed time ({@link recordedBoot}).
 * @example
 * await currentStorageOwner()
 * // => { hostname: 'workstation', machineId: 'f3a1…', machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: '0c1d…' }, processStart: 'linux@4026531836:16362446' }
 */
export async function currentStorageOwner(
  startInputs?: ProcessStartInputs,
  bootInputs?: BootIdentityInputs,
): Promise<StorageOwnerIdentity> {
  const [boot, processStart] = await Promise.all([
    readBootIdentity(undefined, bootInputs),
    readProcessStart(process.pid, startInputs),
  ])
  const hostName = hostname()
  return {
    hostname: hostName,
    machineId: editorMachineId,
    ...deriveMachineKeys(editorMachineId, hostName),
    boot: recordedBoot(boot, processStart),
    processStart,
  }
}

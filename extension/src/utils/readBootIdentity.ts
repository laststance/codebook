import { readFile } from 'node:fs/promises'
import { uptime } from 'node:os'

import { KERNEL_BOOT_ID_PATH, MILLISECONDS_PER_SECOND } from '../constants'

import type { BootIdentity } from './readRecordedOwner'

/**
 * Reads which start of this machine the process runs under, so that a storage owner recorded before a restart is recognised although its process id is in use again; called by {@link currentStorageOwner} each time an owner is recorded or judged.
 * The kernel's boot id needs no clock. Where the system publishes none, the boot time is the wall clock minus the uptime, which a clock correction moves; {@link isFromEarlierBoot} compares it with a tolerance.
 * @param kernelBootIdPath - The file that holds the kernel's boot id; tests name one of their own.
 * @returns
 * - `{ id }` with the kernel's boot id, where that file can be read and is not empty (Linux)
 * - `{ startedAtMs }` with the computed boot time everywhere else (macOS, Windows)
 * @example
 * await readBootIdentity()                 // => { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' } on Linux
 * await readBootIdentity('/no/such/file')  // => { startedAtMs: 1790000000000 }
 */
export async function readBootIdentity(
  kernelBootIdPath: string = KERNEL_BOOT_ID_PATH,
): Promise<BootIdentity> {
  const kernelBootId = await readFile(kernelBootIdPath, 'utf8').then(
    (text) => text.trim(),
    () => '',
  )
  if (kernelBootId) return { id: kernelBootId }
  return {
    startedAtMs: Date.now() - Math.round(uptime() * MILLISECONDS_PER_SECOND),
  }
}

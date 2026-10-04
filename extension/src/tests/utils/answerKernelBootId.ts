import fsPromises from 'node:fs/promises'
import type { TestContext } from 'node:test'

import { KERNEL_BOOT_ID_PATH } from '../../constants'

/**
 * Answers the read of the kernel's boot id file for one test, so that the boot this process names is the same on every system the test runs on: a fixed id, or none, as on macOS and Windows, where {@link readBootIdentity} computes the boot time instead.
 * Every other file is read as usual.
 * @param context - The test, at whose end the real read is back.
 * @param bootId - The kernel's boot id; `undefined` for a system that publishes none.
 * @example
 * answerKernelBootId(context, 'boot-of-this-test') // => (await currentStorageOwner()).boot is { id: 'boot-of-this-test' }
 * answerKernelBootId(context, undefined)           // => (await currentStorageOwner()).boot is { startedAtMs: … }
 */
export function answerKernelBootId(
  context: TestContext,
  bootId: string | undefined,
): void {
  const readFileBefore = fsPromises.readFile
  context.mock.method(
    fsPromises,
    'readFile',
    async (...input: Parameters<typeof readFileBefore>) => {
      if (input[0] !== KERNEL_BOOT_ID_PATH) return readFileBefore(...input)
      if (bootId === undefined)
        throw Object.assign(
          new Error(
            `ENOENT: no such file or directory, open '${KERNEL_BOOT_ID_PATH}'`,
          ),
          { code: 'ENOENT' },
        )
      return `${bootId}\n`
    },
  )
}

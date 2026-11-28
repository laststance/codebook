import { resolve } from 'node:path'

import { StorageLockHeldError } from '../../utils/storageLockHeldError'
import type * as lockModule from '../../utils/withDevinSetupLock'

import { defer } from './defer'
import { loadModule } from './loadModule'

/**
 * Loads {@link lockModule.withDevinSetupLock} over a stand-in of the storage lock it takes (the module `./withStorageLock`), whose taking of the lock and whose release wait while the test holds them, as on a disk that stops answering.
 * Called by the tests of the setup lock's bounds below; each test loads its own copy, so no hold of one test reaches another.
 * @param holds - Which step of the storage lock waits for the test: `acquisition` before the lock is taken, `release` after the locked steps ended; a step left out goes on at once. `heldRefusals`: how many takings refuse first with a {@link StorageLockHeldError}, as while another window holds the lock (`Infinity` for every taking); none when left out.
 * @returns The loaded lock; `storageLockEvents`, what the storage lock did in order (`lock refused`, `lock taken`, `lock released`); `takingsStarted`, how many takings of the storage lock were started so far, also those still waiting; and `letAcquisitionGo` and `letReleaseGo`, which let the held step go on.
 * @example
 * const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
 * storage.letAcquisitionGo() // the lock is taken now
 * await devinSetupLockOverStalledStorage({ acquisition: true, heldRefusals: 1 }) // one refusal, then a taking that waits
 * storage.takingsStarted() // => 1 while the first taking waits
 */
export async function devinSetupLockOverStalledStorage(holds: {
  acquisition?: boolean
  release?: boolean
  heldRefusals?: number
}) {
  const acquisition = defer<void>()
  const release = defer<void>()
  // A step the test does not hold goes on at once.
  if (!holds.acquisition) acquisition.resolve()
  if (!holds.release) release.resolve()
  let heldRefusalsLeft = holds.heldRefusals ?? 0
  const storageLockEvents: string[] = []
  let takingsStarted = 0
  const loaded = await loadModule<typeof lockModule>(
    resolve(__dirname, '../../utils/withDevinSetupLock.js'),
    {
      './withStorageLock': {
        withStorageLock: async <Value>(
          _directory: string,
          locked: () => Promise<Value>,
        ): Promise<Value> => {
          takingsStarted += 1
          // Another window's lock refuses the first takings, as the real storage lock does while it is held.
          if (heldRefusalsLeft > 0) {
            heldRefusalsLeft -= 1
            storageLockEvents.push('lock refused')
            throw new StorageLockHeldError(
              'Learning storage is locked by another writer',
            )
          }
          await acquisition.promise
          storageLockEvents.push('lock taken')
          try {
            return await locked()
          } finally {
            await release.promise
            storageLockEvents.push('lock released')
          }
        },
      },
    },
  )
  return {
    withDevinSetupLock: loaded.withDevinSetupLock,
    storageLockEvents,
    takingsStarted: (): number => takingsStarted,
    letAcquisitionGo: (): void => acquisition.resolve(),
    letReleaseGo: (): void => release.resolve(),
  }
}

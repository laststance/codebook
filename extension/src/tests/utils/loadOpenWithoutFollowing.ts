import { resolve } from 'node:path'

import type * as OpenWithoutFollowingModule from '../../utils/openWithoutFollowing'

import { loadModule } from './loadModule'

/**
 * Loads the utility that opens a path without following a link, as a module a test hands to {@link loadModule} in place of `./openWithoutFollowing`: with the open flags of another system, with another file system, or both.
 * A place that opens through the utility hands it no flags, so a test takes `O_NOFOLLOW` away here and the place takes the way it takes on Windows on every system.
 * @param standIns - `openConstants`: the flags an open takes when its caller hands none (the system's when left out). `fileSystem`: what the loaded utility gets for `node:fs/promises` (the real module when left out). `timesNeedWriteAccess`: a file that was not opened with `read-write` refuses to set its times with `EPERM`, as Windows refuses (there a file's times are set only through a handle with write access).
 * @returns The module, whose `openWithoutFollowing` opens with those flags and that file system.
 * @example
 * const opening = await loadOpenWithoutFollowing({ openConstants: { O_RDONLY: constants.O_RDONLY } })
 * const { hashFileSha256 } = await loadModule<typeof HashModule>(path, { './openWithoutFollowing': opening })
 */
export async function loadOpenWithoutFollowing(standIns: {
  openConstants?: OpenWithoutFollowingModule.NoFollowOpenConstants
  fileSystem?: object
  timesNeedWriteAccess?: boolean
}): Promise<typeof OpenWithoutFollowingModule> {
  const loaded = await loadModule<typeof OpenWithoutFollowingModule>(
    resolve(__dirname, '../../utils/openWithoutFollowing.js'),
    standIns.fileSystem ? { 'node:fs/promises': standIns.fileSystem } : {},
    // A caller tells a refusal by `instanceof Error` and its code; the errors of the loaded opener belong to this realm.
    { Error },
  )
  return {
    openWithoutFollowing: async (
      path,
      openConstants = standIns.openConstants,
      access,
    ) => {
      const file = await loaded.openWithoutFollowing(
        path,
        openConstants,
        access,
      )
      if (standIns.timesNeedWriteAccess && access !== 'read-write')
        file.utimes = async (): Promise<void> => {
          throw Object.assign(
            new Error('EPERM: operation not permitted, futime'),
            { code: 'EPERM', syscall: 'futime' },
          )
        }
      return file
    },
  }
}

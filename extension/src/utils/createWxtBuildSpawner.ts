import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import {
  EXTENSION_BUILD_OUTPUT_FLUSH_MS,
  EXTENSION_BUILD_TREE_POLL_MS,
} from '../constants'

import { isProcessGroupGone } from './isProcessGroupGone'
import { observeWxtBuildExit } from './observeWxtBuildExit'
import { signalProcessGroup } from './signalProcessGroup'
import { watchWxtBuildTree } from './watchWxtBuildTree'
import { windowsSystemProgramPath } from './windowsSystemProgramPath'
import type { WxtBuildProcess, WxtBuildSpawnRequest } from './wxtBuildTypes'

/**
 * Starts the WXT build process for {@link buildWxtExtension} in its own process group (POSIX) or ends its tree with `taskkill /T /F` (Windows).
 * Why: the build must be endable as a whole tree, because WXT starts workers. It is the default spawner of the build step; tests inject a fake.
 * @param request - The executable, arguments, folder and output receiver.
 * @returns The started process with its exit, tree signalling and tree-gone promise.
 * @example
 * const build = createWxtBuildSpawner({ executable: '/usr/bin/node', arguments: ['-e', ''], cwd: '/repo', environment: { PATH: '/usr/bin' }, onOutput() {} })
 */
export function createWxtBuildSpawner(
  request: WxtBuildSpawnRequest,
): WxtBuildProcess {
  const child = spawn(request.executable, [...request.arguments], {
    cwd: request.cwd,
    env: request.environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  for (const channel of ['stdout', 'stderr'] as const) {
    const decoder = new StringDecoder('utf8')
    child[channel].on('data', (chunk: Buffer) =>
      request.onOutput(decoder.write(chunk), channel),
    )
    child[channel].on('end', () => request.onOutput(decoder.end(), channel))
  }
  const { exited, hasLeaderExited } = observeWxtBuildExit(
    child,
    EXTENSION_BUILD_OUTPUT_FLUSH_MS,
  )
  const processGroup = child.pid
  const { treeGone, isTreeGone } = watchWxtBuildTree({
    hasLeaderExited,
    // Windows has no process group to probe; the leader's exit is the best signal there.
    probe: () =>
      process.platform === 'win32' || processGroup === undefined
        ? true
        : isProcessGroupGone(processGroup),
    pollMs: EXTENSION_BUILD_TREE_POLL_MS,
  })
  return {
    exited,
    treeGone,
    isTreeGone,
    signalTree(signal): void {
      if (processGroup === undefined) return
      if (process.platform !== 'win32') {
        signalProcessGroup(processGroup, signal)
        return
      }
      const taskkill = windowsSystemProgramPath(['System32', 'taskkill.exe'])
      // Without a trusted taskkill path no program is started; the leader alone is signalled.
      if (taskkill === undefined) {
        child.kill(signal)
        return
      }
      spawn(taskkill, ['/PID', String(processGroup), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).on('error', () => undefined)
    },
  }
}

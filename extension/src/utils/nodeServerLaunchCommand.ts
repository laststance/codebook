import { repositoryPosixPath } from './repositoryPosixPath'
import type { ResolvedNodeServerLaunch } from './resolveNodeServerLaunch'

/** What one owned server launch is built from: the resolved folder, entry and loader, the workspace the journal names paths relative to, and the external Node a node or tsx launch runs (`launchNodeServer`'s request carries more). */
export type NodeServerLaunchCommandInput = ResolvedNodeServerLaunch & {
  workspace: string
  node: { executable: string; version: string }
}

/** The inspector option of a node or tsx launch: a free loopback port, paused before the entry's first line until the debugger releases it. */
const INSPECTOR_OPTION = '--inspect-brk=127.0.0.1:0'

/**
 * Writes a launch path as the journal names it: inside the repository as `<workspace>/<path>`.
 * @param workspace - The repository's real root.
 * @param path - A real path inside it.
 * @returns The sanitized path.
 * @example
 * journalPath('/repo', '/repo/apps/api/src/server.ts') // => '<workspace>/apps/api/src/server.ts'
 * journalPath('/repo', '/repo')                          // => '<workspace>'
 */
function journalPath(workspace: string, path: string): string {
  const inside = repositoryPosixPath(workspace, path)
  // The repository root itself reads as the bare placeholder.
  return inside === '.' ? '<workspace>' : `<workspace>/${inside}`
}

/**
 * Builds the program and arguments one owned server process runs; called by `launchNodeServer` before the spawn.
 * @param launch - The resolved launch.
 * @returns
 * - node: `node --inspect-brk=127.0.0.1:0 [--import <tsx loader>] [<library hook>] <entry>`, paused before its first line
 * - Bun: `bun --preload <inspector bootstrap> <entry>`, which waits for the debugger in the bootstrap (Bun has no `--inspect-brk` for the protocol the debugger speaks)
 * @example launchCommandOf({ loader: { kind: 'bun', executable: '/Users/learner/.bun/bin/bun', version: '1.4.5', bootstrap: '/ext/dist/bunInspectorBootstrap.js' }, entry: '/repo/src/index.ts', … }) // => { program: '/Users/learner/.bun/bin/bun', args: ['--preload', '/ext/dist/bunInspectorBootstrap.js', '/repo/src/index.ts'] }
 */
export function launchCommandOf(launch: NodeServerLaunchCommandInput): {
  program: string
  args: string[]
} {
  if (launch.loader.kind === 'bun')
    return {
      program: launch.loader.executable,
      args: ['--preload', launch.loader.bootstrap, launch.entry],
    }
  return {
    program: launch.node.executable,
    args: [
      INSPECTOR_OPTION,
      ...(launch.loader.kind === 'tsx' ? ['--import', launch.loader.url] : []),
      // The library's resolve hook loads after the tsx loader, which stays first.
      ...(launch.libraryArguments ?? []),
      launch.entry,
    ],
  }
}

/**
 * The launch facts the start journal records, with every path written relative to the workspace; called by `launchNodeServer` for `node-server.started`.
 * @param launch - The resolved launch.
 * @returns The journaled arguments, folder, loader and runtime release (`nodeVersion` for node and tsx, `bunVersion` for Bun).
 * @example journaledLaunchOf(bunLaunch) // => { args: ['--preload', '<inspector-bootstrap>', 'src/index.ts'], cwd: '.', loader: 'bun', bunVersion: '1.4.5' }
 */
export function journaledLaunchOf(launch: NodeServerLaunchCommandInput) {
  const cwd = journalPath(launch.workspace, launch.packageRoot)
  const entry = journalPath(launch.workspace, launch.entry)
  // Bun's executable and the bootstrap lie outside the workspace; the journal names the bootstrap by its role only.
  if (launch.loader.kind === 'bun')
    return {
      args: ['--preload', '<inspector-bootstrap>', entry],
      cwd,
      loader: 'bun',
      bunVersion: launch.loader.version,
    }
  return {
    args: [
      INSPECTOR_OPTION,
      ...(launch.loader.kind === 'tsx'
        ? ['--import', journalPath(launch.workspace, launch.loader.path)]
        : []),
      ...(launch.libraryArguments ? ['--import', '<library-hook>'] : []),
      entry,
    ],
    cwd,
    loader:
      launch.loader.kind === 'tsx'
        ? journalPath(launch.workspace, launch.loader.path)
        : 'node',
    nodeVersion: launch.node.version,
  }
}

import { basename, isAbsolute, relative, sep } from 'node:path'

import { StudyError } from '../errors'

import { sanitizeDeclaredPath } from './resolveNextPackage'

/** What a workspace opened below the Git root looks like, in names only (no absolute path). */
export type NestedWorkspace = {
  /** The Git root's folder name; `the Git root folder` when the root has no name (a filesystem root). */
  gitRootName: string
  /** The opened folder's repository-relative POSIX path, the exact `packageRoot` to declare; `undefined` when the opened folder does not lie below the Git root by path (a link). */
  packageRoot?: string
}

/**
 * Names a workspace opened below the Git root without any absolute path: the Git root's folder name and the opened folder's repository-relative path.
 *
 * Called by {@link describeNestedWorkspaceRefusal}, `codebook_status` readiness and the source authoring check, so the three say the same thing (K4/C7, DX-13).
 *
 * @param gitRoot - The real path of the Git top level.
 * @param workspace - The real path of the opened folder.
 * @returns The names; both are sanitized for a message.
 * @example describeNestedWorkspace('/home/ada/p02', '/home/ada/p02/examples/react/nextjs') // => { gitRootName: 'p02', packageRoot: 'examples/react/nextjs' }
 */
export function describeNestedWorkspace(
  gitRoot: string,
  workspace: string,
): NestedWorkspace {
  const rootName = basename(gitRoot)
  const path = relative(gitRoot, workspace)
  const isBelow = path !== '' && !path.startsWith('..') && !isAbsolute(path)
  return {
    gitRootName: sanitizeDeclaredPath(rootName || 'the Git root folder'),
    ...(isBelow
      ? { packageRoot: sanitizeDeclaredPath(path.split(sep).join('/')) }
      : {}),
  }
}

/**
 * Words the adapter-aware recovery of a workspace opened below the Git root.
 *
 * The opened folder cannot run anything: source authoring refuses every adapter there. A Next app runs from the repository root with `packageRoot` set to the folder's repository-relative path; the other adapters do not support a folder below the root yet.
 *
 * @param nested - The names from {@link describeNestedWorkspace}.
 * @returns One sentence-group the chat can follow without guessing: the Git root's folder name, the exact `packageRoot`, the instruction to ask the learner to open that folder and not to retry in this window, and what other adapters can do.
 * @example describeNestedWorkspaceRecovery({ gitRootName: 'p02', packageRoot: 'examples/react/nextjs' }) // => 'This folder lies inside the Git repository "p02" …'
 */
export function describeNestedWorkspaceRecovery(
  nested: NestedWorkspace,
): string {
  const folder = nested.packageRoot
    ? ` at "${nested.packageRoot}"`
    : ' below its root'
  const declaration = nested.packageRoot
    ? `with packageRoot "${nested.packageRoot}"`
    : "with packageRoot set to the opened folder's repository-relative path"
  return `This folder lies inside the Git repository "${nested.gitRootName}"${folder}, and no adapter can run from it. Ask the learner to open the "${nested.gitRootName}" folder (the repository root) in the editor; do not retry in this window. A Next app (next-dev-webpack) then runs from the repository root ${declaration}. Other adapters (vite-dev, node-server, node-test, chrome-extension) do not support a folder below the repository root yet and have no workaround.`
}

/**
 * Builds the `PREREQUISITE_MISSING` refusal of a source authoring call in a workspace opened below the Git root.
 *
 * Why it exists: the check at `RepositorySourceService.catalog` serves every adapter, so its message is adapter-aware (DX-13) and overrides the generic `PREREQUISITE_MISSING` recovery with the same text. Called by `RepositorySourceService`.
 *
 * @param gitRoot - The real path of the Git top level.
 * @param workspace - The real path of the opened folder.
 * @returns The refusal; `details` carry `reason: "nested-workspace"`, `gitRoot` (the folder name), `packageRoot` and `sideEffects: "none"`.
 * @example throw describeNestedWorkspaceRefusal('/home/ada/p02', '/home/ada/p02/examples/react/nextjs')
 */
export function describeNestedWorkspaceRefusal(
  gitRoot: string,
  workspace: string,
): StudyError {
  const nested = describeNestedWorkspace(gitRoot, workspace)
  const recovery = describeNestedWorkspaceRecovery(nested)
  return new StudyError(
    'PREREQUISITE_MISSING',
    recovery,
    recovery,
    recovery,
    undefined,
    {
      reason: 'nested-workspace',
      gitRoot: nested.gitRootName,
      ...(nested.packageRoot ? { packageRoot: nested.packageRoot } : {}),
      sideEffects: 'none',
    },
  )
}

import type { CauseRoots } from './sanitizeCause'

/**
 * Groups a window's private roots by the words that replace them, in the order a spelling shared by several kinds is claimed: storage, workspace, home.
 * Why: the output stage and the debugger-value hider must claim a shared spelling the same way. Called by {@link createRootHidingStage} and {@link hideTrailingRootPrefix}.
 * @param roots - The private roots of this window.
 * @returns Each placeholder with the roots it stands for.
 * @example rootPlaceholderKinds({ storage: [], home: '/Users/ada' })[2] // => ['~', ['/Users/ada']]
 */
export function rootPlaceholderKinds(
  roots: CauseRoots,
): [string, readonly string[]][] {
  return [
    ['<storage>', roots.storage],
    ['<workspace>', [roots.workspace ?? []].flat()],
    ['~', [roots.home ?? []].flat()],
  ]
}

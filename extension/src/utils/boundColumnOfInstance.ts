import type { createBundleVerifier } from './createBundleVerifier'

type ColumnsOfLine = Pick<
  ReturnType<typeof createBundleVerifier>,
  'mappedColumnsOfLine'
>

/**
 * Gives the column at which a script's own map puts the statement that a stop was bound on in another script of the same module, so a pause in that script is judged by its own map and not by the column of the other script's map.
 * Next compiles one source file once per webpack layer and each instance carries a map of its own, so one statement can sit at another original column in each. A statement is the Nth mapped column of its line in both maps, which holds while both maps put the same number of statements on the line; when they do not, or the bound column is no mapped column of the sealed map, the statement cannot be matched and the bound column itself stands.
 * Called by {@link ConfiguredBrowserRun} when it compares a pause in an accepted instance with a stop's bound column ({@link isPauseAtBoundColumn}).
 * @param sealed - The verifier of the script the stop was bound in.
 * @param instance - The verifier of the instance the pause is in.
 * @param bound - Where the debugger bound the stop, in the sealed script's map.
 * @returns The one-based original column of that statement in the instance's map.
 * @example
 * ```ts
 * boundColumnOfInstance(sealed, instance, { line: 1, column: 9 }) // 4 when the sealed map has columns [1, 9] on line 1 and the instance's has [1, 4]
 * ```
 */
export function boundColumnOfInstance(
  sealed: ColumnsOfLine,
  instance: ColumnsOfLine,
  bound: { line: number; column: number },
): number {
  const sealedColumns = sealed.mappedColumnsOfLine(bound.line),
    instanceColumns = instance.mappedColumnsOfLine(bound.line),
    rank = sealedColumns.indexOf(bound.column)
  // Two maps that disagree on how many statements the line holds give no way to match one with the other.
  return rank >= 0 && sealedColumns.length === instanceColumns.length
    ? instanceColumns[rank]!
    : bound.column
}

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'

import {
  previewShowsCredentialShape,
  redactValuePreview,
} from './redactValuePreview'
import { classNameOf, findSecretSiblingIndexes } from './secretShapes'
import { withheldVariableValue } from './withheldVariableValue'

type SavedVariable = ReplayDebugSnapshot['variables'][number]

/**
 * Finds which variables a neighbour names as secret and the name of each variable's parent.
 * @param snapshot - A validated snapshot.
 * @returns The indices of the masked siblings and each child's parent name.
 */
function readSiblingContext(snapshot: ReplayDebugSnapshot): {
  maskedSiblings: Set<number>
  parentNames: Map<number, string>
} {
  const { variables } = snapshot
  const maskedSiblings = new Set<number>()
  const parentNames = new Map<number, string>()
  for (const variable of variables)
    for (const child of variable.children) parentNames.set(child, variable.name)
  // The siblings of one list are the variables of one scope or the children of one variable.
  const lists = [
    ...snapshot.frames.flatMap((frame) =>
      frame.scopes.map((scope) => scope.variables),
    ),
    ...variables.map((variable) => variable.children),
  ]
  for (const list of lists) {
    const siblings = list.flatMap((index) => variables[index] ?? [])
    // A list with a dangling index is not a list this rule can read.
    if (siblings.length !== list.length) continue
    for (const position of findSecretSiblingIndexes(siblings))
      maskedSiblings.add(list[position]!)
  }
  return { maskedSiblings, parentNames }
}

/**
 * Decides the saved form of every variable: a withheld variable keeps no children and a value that is the mask or its class name; a parent (it has children, or children the capture could not read) keeps a preview that shows a credential shape only as its class name; any other preview is masked in place.
 * @param snapshot - A validated snapshot.
 * @returns The decided variable for each index (the original object when nothing about it changes), and whether anything changed.
 */
function decideVariables(snapshot: ReplayDebugSnapshot): {
  decided: SavedVariable[]
  didChange: boolean
} {
  const { maskedSiblings, parentNames } = readSiblingContext(snapshot)
  let didChange = false
  const decided = snapshot.variables.map((variable, index): SavedVariable => {
    const withheld = withheldVariableValue(
      variable,
      parentNames.get(index),
      maskedSiblings.has(index),
    )
    const isParent =
      variable.children.length > 0 || variable.unavailable !== undefined
    // Children that were masked or never read cannot vouch for the parent's own preview: its text stays only when it shows no credential shape.
    const value =
      withheld ??
      (isParent && previewShowsCredentialShape(variable.value)
        ? classNameOf(variable)
        : redactValuePreview(variable.value))
    if (withheld !== undefined) {
      const { unavailable: _unavailable, ...kept } = variable
      if (
        withheld === variable.value &&
        variable.children.length === 0 &&
        variable.unavailable === undefined
      )
        return variable
      didChange = true
      return { ...kept, value: withheld, children: [] }
    }
    if (value === variable.value) return variable
    didChange = true
    return { ...variable, value }
  })
  return { decided, didChange }
}

/**
 * Lists the variables a snapshot still reaches: from its scopes down through the children of each variable the mask kept.
 * @param snapshot - A validated snapshot.
 * @param decided - The decided variables ({@link decideVariables}).
 * @returns The reachable indices.
 */
function reachableVariables(
  snapshot: ReplayDebugSnapshot,
  decided: readonly SavedVariable[],
): Set<number> {
  const reachable = new Set<number>()
  const pending = snapshot.frames.flatMap((frame) =>
    frame.scopes.flatMap((scope) => scope.variables),
  )
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    const variable = decided[index]
    if (reachable.has(index) || variable === undefined) continue
    reachable.add(index)
    pending.push(...variable.children)
  }
  return reachable
}

/**
 * Applies the redaction contract again to a debugger snapshot a history saved, so a study saved before the shape rules (0.2.73.1 and earlier) no longer serves a cookie, session or credential value.
 * Why: the capture masks what it saves, but a history on disk keeps what its version saved; the replay debug session, the chat's detail resources and the rehydration all call this after the history's integrity check and before they serialise, page or show it. The recorded source text (`frame.source.text`, checked by its SHA-256) is never touched.
 *
 * Per variable: a secret-named variable, the `value` beside a secret `name` or `key`, and the element after a secret header name in a flat header array read {@link REDACTION_MASK} with no children; an instance of a cookie or header store, a socket or a response, `process.env` and `previewData` keep only their class name; every other preview is masked by {@link redactValuePreview}, and a parent keeps a preview that shows a credential shape only as its class name. Variables no scope reaches any longer are removed and the indices renumbered.
 * @param snapshot - A validated debugger snapshot.
 * @returns The same object when nothing needs masking; otherwise a copy that passes the snapshot schema.
 * @example
 * maskSavedDebugSnapshot(snapshotWithCookieRecord).variables[1]?.value // => '[masked]'
 */
export function maskSavedDebugSnapshot(
  snapshot: ReplayDebugSnapshot,
): ReplayDebugSnapshot {
  const { decided, didChange } = decideVariables(snapshot)
  const reachable = reachableVariables(snapshot, decided)
  if (!didChange && reachable.size === decided.length) return snapshot
  // The kept variables keep their order, so every child still comes after its parent.
  const renumbered = new Map<number, number>()
  for (const index of decided.keys())
    if (reachable.has(index)) renumbered.set(index, renumbered.size)
  const renumber = (indices: readonly number[]): number[] =>
    indices.flatMap((index) => renumbered.get(index) ?? [])
  return {
    ...snapshot,
    frames: snapshot.frames.map((frame) => ({
      ...frame,
      scopes: frame.scopes.map((scope) => ({
        ...scope,
        variables: renumber(scope.variables),
      })),
    })),
    variables: decided.flatMap((variable, index) =>
      reachable.has(index)
        ? { ...variable, children: renumber(variable.children) }
        : [],
    ),
  }
}

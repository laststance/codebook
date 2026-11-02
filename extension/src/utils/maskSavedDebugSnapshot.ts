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
 * @returns The decided variable for each index (the original object when nothing about it changes), whether anything changed, and the variables that are withheld.
 */
function decideVariables(snapshot: ReplayDebugSnapshot): {
  decided: SavedVariable[]
  didChange: boolean
  withheld: Set<number>
} {
  const { maskedSiblings, parentNames } = readSiblingContext(snapshot)
  const withheld = new Set<number>()
  let didChange = false
  const decided = snapshot.variables.map((variable, index): SavedVariable => {
    const withheldValue = withheldVariableValue(
      variable,
      parentNames.get(index),
      maskedSiblings.has(index),
    )
    if (withheldValue !== undefined) {
      withheld.add(index)
      if (
        withheldValue === variable.value &&
        variable.children.length === 0 &&
        variable.unavailable === undefined
      )
        return variable
      didChange = true
      const { unavailable: _unavailable, ...kept } = variable
      return { ...kept, value: withheldValue, children: [] }
    }
    const isParent =
      variable.children.length > 0 || variable.unavailable !== undefined
    // Children that were masked or never read cannot vouch for the parent's own preview: its text stays only when it shows no credential shape.
    const value =
      isParent && previewShowsCredentialShape(variable.value)
        ? classNameOf(variable)
        : redactValuePreview(variable.value)
    if (value === variable.value) return variable
    didChange = true
    return { ...variable, value }
  })
  return { decided, didChange, withheld }
}

/**
 * Lists the variables an older snapshot saved below a variable that is now withheld, which the mask drops.
 * @param snapshot - A validated snapshot as it was saved.
 * @param withheld - The withheld variables ({@link decideVariables}).
 * @returns The indices of every descendant of a withheld variable.
 */
function droppedBelow(
  snapshot: ReplayDebugSnapshot,
  withheld: ReadonlySet<number>,
): Set<number> {
  const dropped = new Set<number>()
  const pending = [...withheld].flatMap(
    (index) => snapshot.variables[index]?.children ?? [],
  )
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    if (dropped.has(index)) continue
    dropped.add(index)
    pending.push(...(snapshot.variables[index]?.children ?? []))
  }
  return dropped
}

/**
 * Applies the redaction contract again to a debugger snapshot a history saved, so a study saved before the shape rules (0.2.73.1 and earlier) no longer serves a cookie, session or credential value.
 * Why: the capture masks what it saves, but a history on disk keeps what its version saved; the replay debug session, the chat's detail resources and the rehydration all call this after the history's integrity check and before they serialise, page or show it. The recorded source text (`frame.source.text`, checked by its SHA-256) is never touched.
 *
 * Per variable: a secret-named variable, the `value` beside a secret `name` or `key`, and the element after a secret header name in a flat header array read {@link REDACTION_MASK} with no children; an instance of a cookie or header store, a socket or a response, `process.env` and `previewData` keep only their class name; every other preview is masked by {@link redactValuePreview}, and a parent keeps a preview that shows a credential shape only as its class name. The variables an older snapshot saved below a withheld variable are removed and the indices renumbered.
 * @param snapshot - A validated debugger snapshot.
 * @returns The same object when nothing needs masking; otherwise a copy that passes the snapshot schema.
 * @example
 * maskSavedDebugSnapshot(snapshotWithCookieRecord).variables[1]?.value // => '[masked]'
 */
export function maskSavedDebugSnapshot(
  snapshot: ReplayDebugSnapshot,
): ReplayDebugSnapshot {
  const { decided, didChange, withheld } = decideVariables(snapshot)
  const dropped = droppedBelow(snapshot, withheld)
  if (!didChange && dropped.size === 0) return snapshot
  // The kept variables keep their order, so every child still comes after its parent.
  const renumbered = new Map<number, number>()
  for (const index of decided.keys())
    if (!dropped.has(index)) renumbered.set(index, renumbered.size)
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
      dropped.has(index)
        ? []
        : { ...variable, children: renumber(variable.children) },
    ),
  }
}

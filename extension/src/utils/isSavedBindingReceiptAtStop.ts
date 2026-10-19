import type { ConfiguredObservation } from '../configuredStudySchemas'

/** The run's saved receipt that its binding rule held for a stop, as the study's schema holds it: the declared line, the requested line when the breakpoint was requested after an unmapped declared line, and the bound line, with nothing that could run between the requested (or declared) and the bound line: no mapped line, or, once the run had read the debugger's break locations, no line whose break location lies in the generated module between the place the breakpoint was requested at and the place it was bound at (when either generated place was not known, no line with a break location at all). `mappedLinesBetween` is always 0 and stays in the format for studies already saved; since 0.2.30 it is also written when mapped lines the debugger cannot pause on lie between, and when a line between has its break location elsewhere in the generated module. */
type BindingReceipt = NonNullable<ConfiguredObservation['source']['binding']>

/**
 * Tells whether a receipt's requested line is one the run's rule can produce; called by {@link isReceiptOfStop} as its last condition.
 * @param receipt - The saved receipt.
 * @returns `true` without a requested line, and for one after the declared line; `false` for a requested line at or before the declared one.
 * @example
 * isRequestedAfterDeclared({ declaredLine: 73, requestedLine: 74, boundLine: 75, mappedLinesBetween: 0 }) // => true
 * isRequestedAfterDeclared({ declaredLine: 73, requestedLine: 73, boundLine: 75, mappedLinesBetween: 0 }) // => false
 */
function isRequestedAfterDeclared(receipt: BindingReceipt): boolean {
  // A requested line lies after the declared one; the bound line may lie on either side of it, as the run's rule accepts.
  return (
    receipt.requestedLine === undefined ||
    receipt.requestedLine > receipt.declaredLine
  )
}

/**
 * Tells whether a saved receipt agrees with the stop it is saved on; called by {@link isSavedBindingReceiptAtStop} for an observation that carries one.
 * @param receipt - The saved receipt.
 * @param source - The saved observation's line.
 * @param declaredLine - The line the stop was declared on.
 * @returns `true` when the receipt names the declared line and the observed line, the observed one not before the declared one, and a requested line only after the declared one ({@link isRequestedAfterDeclared}).
 * @example
 * isReceiptOfStop({ declaredLine: 22, boundLine: 23, mappedLinesBetween: 0 }, { line: 23 }, 22) // => true
 * isReceiptOfStop({ declaredLine: 22, boundLine: 24, mappedLinesBetween: 0 }, { line: 23 }, 22) // => false
 */
function isReceiptOfStop(
  receipt: BindingReceipt,
  source: { line: number },
  declaredLine: number,
): boolean {
  return (
    receipt.declaredLine === declaredLine &&
    receipt.boundLine === source.line &&
    receipt.boundLine >= receipt.declaredLine &&
    isRequestedAfterDeclared(receipt)
  )
}

/**
 * Tells whether a saved observation's binding receipt agrees with the line it was declared on and the line it was captured at, for {@link validateConfiguredStudyEvidence} when a study is decoded or reopened.
 * A saved study has no sealed map to repeat the run's rule with (a line after the requested one is the stop only when no line between the two has a mapped position or, once the debugger listed its break locations, a break location between the generated place the breakpoint was requested at and the generated place it was bound at), so the run saves a receipt that the rule held; this check accepts every receipt the run's rule ({@link createBindingLineRule}) can produce. Legacy rule: studies saved by 0.2.27 and older carry no receipt on any observation; such a study keeps their rule, which {@link isSavedSourceAtStop} applies (a later line up to the citation's end, confirmed by the saved debugger state).
 * @param source - The saved observation's line and, when saved, its receipt.
 * @param declaredLine - The line the stop was declared on.
 * @param studyHasBindingReceipts - Whether any observation of the study carries a receipt, which tells a study of this format from a legacy one.
 * @returns
 * - `true` for a receipt that names the declared line and the observed line, the observed one not before the declared one, and, when it names a requested line, that line after the declared one (the run's rule accepts a bound line from the declared line to the requested one as well as after it)
 * - `true` without a receipt on the declared line, and on a later line only in a legacy study
 * - `false` for a receipt that contradicts the lines, and for a later line without a receipt in a study that carries receipts
 * @example
 * isSavedBindingReceiptAtStop({ line: 23, binding: { declaredLine: 22, boundLine: 23, mappedLinesBetween: 0 } }, 22, true) // => true
 * isSavedBindingReceiptAtStop({ line: 23 }, 22, true) // => false
 * isSavedBindingReceiptAtStop({ line: 75, binding: { declaredLine: 73, requestedLine: 74, boundLine: 75, mappedLinesBetween: 0 } }, 73, true) // => true
 * isSavedBindingReceiptAtStop({ line: 75, binding: { declaredLine: 73, requestedLine: 76, boundLine: 75, mappedLinesBetween: 0 } }, 73, true) // => true: bound between the declared and the requested line
 * isSavedBindingReceiptAtStop({ line: 23 }, 22, false) // => true: a study saved by 0.2.27
 */
export function isSavedBindingReceiptAtStop(
  source: { line: number; binding?: BindingReceipt },
  declaredLine: number,
  studyHasBindingReceipts: boolean,
): boolean {
  const receipt = source.binding
  if (receipt) return isReceiptOfStop(receipt, source, declaredLine)
  return source.line === declaredLine || !studyHasBindingReceipts
}

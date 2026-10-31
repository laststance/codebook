/**
 * Says whether the gate ran on a clean checkout, as the summary's `Checkout:` line.
 *
 * Why: `--allow-dirty` trial runs write `GATE: pass` into the same `artifacts/gate/<short HEAD>/summary.txt` as the real gate, so `merge-pr.mjs` must be able to tell them apart (Cycle 0068, D13).
 * Called by `runGate` in `gate.mjs` with its first `listChanges()` result; the line is the first line `runGate` prints (the summary's `HEAD` and `Logs in` lines come before it).
 *
 * @param {string[]} changes - What {@link listCheckoutChanges} reported when the gate started.
 * @returns {string} `Checkout: clean` for no change, `Checkout: changed (--allow-dirty trial run)` otherwise.
 * @example
 * describeGateCheckout([]) // => 'Checkout: clean'
 * describeGateCheckout([' M README.md']) // => 'Checkout: changed (--allow-dirty trial run)'
 */
export function describeGateCheckout(changes) {
  return changes.length === 0
    ? 'Checkout: clean'
    : 'Checkout: changed (--allow-dirty trial run)'
}

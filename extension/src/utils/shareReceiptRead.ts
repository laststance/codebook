/** The key of one kind of read of one file: `receipt:` for a {@link readReceiptState} answer, `descriptor:` for a {@link readPrivateJsonState} answer of a connection descriptor, `look:` for a look at a file's entry; one key never mixes answer types. */
export type PathReadKey = `${'receipt' | 'descriptor' | 'look'}:${string}`

/** Shares reads of one file among the callers that ask while one is in flight; made by {@link createPathReadGate}. */
export interface PathReadGate {
  /**
   * Reads under a key: with no read of that key in flight it starts `start` now; otherwise the caller shares the one fresh read that starts once the read in flight settled.
   * @param key - The kind of read and the file's path.
   * @param start - Starts the read; called at most once per fresh read, never while another read of the key is in flight.
   * @returns The answer of a read that began after this call (or with it); rejects with that read's rejection.
   */
  read: <Value>(key: PathReadKey, start: () => Promise<Value>) => Promise<Value>
}

/** One key's read in flight and the fresh read queued behind it. */
interface ReadSlot {
  /** Settles, never rejecting, once the read in flight settled. */
  settled: Promise<void>
  /** The fresh read every caller that came while the read was in flight shares; it starts once {@link ReadSlot.settled} settled. */
  next?: Promise<unknown>
}

/**
 * Makes a gate that keeps one read per key in flight and never answers a caller from a read that began before its call (drain, then read afresh), so a storage that stops answering holds one thread of the file pool per file instead of one per refresh or retry, and a decision taken after a removal never accepts an older `installed`; one instance per test, {@link defaultPathReadGate} in production.
 * A read that never returns blocks the fresh read behind it: the callers that joined wait in their own deadlines, and no second read of that file starts.
 * @returns A {@link PathReadGate} with its own slots.
 * @example
 * const reads = createPathReadGate()
 * const first = reads.read('receipt:/s/devin-mcp/receipt.json', () => readReceiptState(path)) // starts a read
 * const second = reads.read('receipt:/s/devin-mcp/receipt.json', () => readReceiptState(path)) // starts one more only after `first` settled
 */
export function createPathReadGate(): PathReadGate {
  const slots = new Map<string, ReadSlot>()
  /** Starts a read under a key that has none in flight, and ends its slot when it settles. @example startRead('look:/s/devin-mcp/receipt.json', () => lstat(path)) */
  const startRead = <Value>(
    key: PathReadKey,
    start: () => Promise<Value>,
  ): Promise<Value> => {
    // A start that throws at once rejects its read like one that fails later.
    const current = new Promise<Value>((resolve) => resolve(start()))
    const slot: ReadSlot = { settled: current.then(noAnswer, noAnswer) }
    slots.set(key, slot)
    // Registered before any caller joins, so the slot is gone before the fresh read behind it starts its own.
    void slot.settled.then(() => slots.delete(key))
    return current
  }
  return {
    read: <Value>(
      key: PathReadKey,
      start: () => Promise<Value>,
    ): Promise<Value> => {
      const slot = slots.get(key)
      if (!slot) return startRead(key, start)
      slot.next ??= slot.settled.then(() => startRead(key, start))
      // The key's prefix names the kind of read, so the fresh read under it answers the caller's type.
      return slot.next as Promise<Value>
    },
  }
}

/** Ignores a settled read's answer or rejection, so a slot's `settled` never rejects. @example current.then(noAnswer, noAnswer) */
function noAnswer(): void {
  // The read's own callers handle its answer.
}

/** The gate the extension and the Devin bridge share in one process, so every receipt, descriptor and look read of one file goes through one slot. @example await defaultPathReadGate.read('receipt:/s/devin-skill/receipt.json', () => readReceiptState(path)) */
export const defaultPathReadGate = createPathReadGate()

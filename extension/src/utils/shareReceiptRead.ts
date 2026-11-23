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
  /** The fresh read every caller that came while the read was in flight shares; it starts in the step that ends the read in flight. */
  next?: Promise<unknown>
  /** Starts {@link ReadSlot.next} and gives the key to it; set together with it. */
  startNext?: () => void
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
  /** Starts a read under a key that has none in flight; the step that sees it settle either starts the read queued behind it or frees the key. @example startRead('look:/s/devin-mcp/receipt.json', () => lstat(path)) */
  const startRead = <Value>(
    key: PathReadKey,
    start: () => Promise<Value>,
  ): Promise<Value> => {
    // A start that throws at once rejects its read like one that fails later.
    const current = new Promise<Value>((resolve) => resolve(start()))
    const slot: ReadSlot = {}
    slots.set(key, slot)
    const handOn = (): void => {
      // The queued read takes the key over in this same step, so no caller finds the key free in between and starts a second read beside it.
      if (slot.startNext) slot.startNext()
      else slots.delete(key)
    }
    void current.then(handOn, handOn)
    return current
  }
  return {
    read: <Value>(
      key: PathReadKey,
      start: () => Promise<Value>,
    ): Promise<Value> => {
      const slot = slots.get(key)
      if (!slot) return startRead(key, start)
      // The executor runs at once, so the slot holds the fresh read and its start together.
      slot.next ??= new Promise<unknown>((resolve) => {
        slot.startNext = (): void => resolve(startRead(key, start))
      })
      // The key's prefix names the kind of read, so the fresh read under it answers the caller's type.
      return slot.next as Promise<Value>
    },
  }
}

/** The gate the extension and the Devin bridge share in one process, so every receipt, descriptor and look read of one file goes through one slot. @example await defaultPathReadGate.read('receipt:/s/devin-skill/receipt.json', () => readReceiptState(path)) */
export const defaultPathReadGate = createPathReadGate()

/**
 * Gives the fields every history resource opens with: the header, the state and reason, the seal's outcome (never its hashes) and the entry count.
 * Called by the server and the chrome-extension history resources for the history's own page.
 * @param history - A verified history as the store reads it.
 * @returns The headline, with `seal` absent for a history that has none.
 * @example describeHistoryHeadline(history).seal?.status // => 'complete'
 */
export function describeHistoryHeadline<
  Header,
  Seal extends {
    status: string
    endedAt: string
    entryCount: number
    capture: string
  },
>(history: {
  header: Header
  status: string
  reason?: string
  seal?: Seal
  entries: readonly unknown[]
}) {
  const { seal } = history
  return {
    header: history.header,
    status: history.status,
    reason: history.reason,
    seal: seal && {
      status: seal.status,
      endedAt: seal.endedAt,
      entryCount: seal.entryCount,
      capture: seal.capture,
    },
    entryCount: history.entries.length,
  }
}

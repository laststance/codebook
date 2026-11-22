/** The running count and the queue of tasks waiting for a free slot; one per kind of work that must not run more than a fixed number at once. */
export interface SlotLimit {
  running: number
  waiting: Array<() => void>
}

/**
 * Makes an empty {@link SlotLimit}; called by the Devin bridge's selection state.
 * @returns A limit with nothing running or waiting.
 * @example
 * createSlotLimit() // => { running: 0, waiting: [] }
 */
export function createSlotLimit(): SlotLimit {
  return { running: 0, waiting: [] }
}

/**
 * Runs `task` once fewer than `maximum` tasks of `limit` run, so a folder of many files never opens more of them at once than the process's file-descriptor limit allows; called by the Devin bridge for each descriptor read.
 * Tasks start in the order they asked. The slot is freed when the task settles, whether it resolves or rejects.
 * @param limit - The running count and queue shared by every task of one kind.
 * @param maximum - The most tasks that run at once.
 * @param task - The work to run.
 * @returns What `task` resolves with.
 * @throws What `task` rejects with.
 * @example
 * await runWithinSlotLimit(limit, 16, () => readFile(path)) // at most 16 reads run together
 */
export async function runWithinSlotLimit<Answer>(
  limit: SlotLimit,
  maximum: number,
  task: () => Promise<Answer>,
): Promise<Answer> {
  // A full limit queues the task until a running one hands over its slot.
  if (limit.running >= maximum)
    await new Promise<void>((resolve) => limit.waiting.push(resolve))
  else limit.running += 1
  try {
    return await task()
  } finally {
    // The freed slot goes straight to the next waiting task, so the running count stays at the maximum while any wait.
    const next = limit.waiting.shift()
    if (next) next()
    else limit.running -= 1
  }
}

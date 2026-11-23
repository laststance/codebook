import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { removeTestFolder } from './removeTestFolder'

/** A bridge child process as {@link HandMovedInputClock}'s `advance` reaches it: its signals and its stderr so far. */
interface ClockedBridgeChild {
  signal: (name: NodeJS.Signals) => void
  readStderr: () => string
}

/** The input clock of a bridge child process that a test moves by hand, as {@link handMovedInputClock} makes it. */
interface HandMovedInputClock {
  /** Source of a preload, appended to {@link bridgeStopMarksPreload}, that replaces the members of the child's {@link BRIDGE_INPUT_CLOCK}: its time stands at 0 until `advance` moves it, and the wait it armed at the startup input limit runs only from `advance`. */
  preloadSource: string
  /**
   * Moves the child's input clock forward and resolves once the child marked it (`INPUT_CLOCK_ADVANCED <n>` on stderr, after every wait it ran).
   * @param child - The bridge child process the preload runs in.
   * @param advanceMs - How far the clock moves.
   * @param options - `runsDueWaits: false` moves the time without running a wait that fell due, as a busy event loop that has not run a due timer yet; every due wait runs, the earliest first, otherwise.
   */
  advance: (
    child: ClockedBridgeChild,
    advanceMs: number,
    options?: { runsDueWaits: boolean },
  ) => Promise<void>
}

/**
 * Gives a bridge child-process test the input clock of its child to move by hand, so the order of the first handshake's settlement and the end of the wait at the startup input limit is set by the test, not by timing (Cycle 0147 task 8, Codex review D14); the arrange step of the bridge tests that order those two.
 * The preload requires {@link BRIDGE_INPUT_CLOCK} by the absolute path this process resolves, the module the bridge loads, and the test sends its commands through a file and SIGUSR2.
 * @param context - The test context; its cleanup removes the command file's folder.
 * @returns The preload's source and `advance` ({@link HandMovedInputClock}).
 * @example
 * const inputClock = await handMovedInputClock(context)
 * const bridge = await startCursorBridgeChild(endpoint, bridgeStopMarksPreload() + inputClock.preloadSource)
 * await inputClock.advance(bridge, 12_000)
 */
export async function handMovedInputClock(context: {
  after: (callback: () => Promise<void>) => void
}): Promise<HandMovedInputClock> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-input-clock-'))
  context.after(() => removeTestFolder(directory))
  const commandPath = join(directory, 'command.json')
  const clockPath = require.resolve('../../utils/bridgeInputClock')
  let advances = 0
  const preloadSource = `{
  const { readFileSync, writeSync } = require('node:fs')
  const clock = require(${JSON.stringify(clockPath)}).BRIDGE_INPUT_CLOCK
  let clockNowMs = 0, clockAdvances = 0
  const clockWaits = new Set()
  clock.now = () => clockNowMs
  clock.set = (callback, delayMs) => {
    const wait = { at: clockNowMs + delayMs, callback }
    clockWaits.add(wait)
    return () => clockWaits.delete(wait)
  }
  process.on('SIGUSR2', () => {
    const command = JSON.parse(readFileSync(${JSON.stringify(commandPath)}, 'utf8'))
    clockNowMs += command.advanceMs
    if (command.runsDueWaits)
      for (const wait of [...clockWaits].sort((first, second) => first.at - second.at)) {
        if (wait.at > clockNowMs || !clockWaits.has(wait)) continue
        clockWaits.delete(wait)
        wait.callback()
      }
    clockAdvances += 1
    writeSync(2, 'INPUT_CLOCK_ADVANCED ' + clockAdvances + '\\n')
  })
}
`
  return {
    preloadSource,
    advance: async (
      child,
      advanceMs,
      options = { runsDueWaits: true },
    ): Promise<void> => {
      advances += 1
      await writeFile(
        commandPath,
        JSON.stringify({ advanceMs, runsDueWaits: options.runsDueWaits }),
      )
      child.signal('SIGUSR2')
      await waitUntil(
        () => child.readStderr().includes(`INPUT_CLOCK_ADVANCED ${advances}\n`),
        `the bridge's input clock advanced ${advances} times`,
        10_000,
        undefined,
        5,
      )
    },
  }
}

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import type { TestContext } from 'node:test'

/**
 * Starts a real process of the test that does nothing until the test ends, and waits until it runs: a live process with an id and a start of its own, as the editor window that holds a storage lock is.
 * It is started with this Node binary and without a shell, so it runs the same way on Windows.
 * @param context - The test, at whose end the process is killed.
 * @returns The running child; its `pid` names a live process.
 * @example
 * const child = await idleChild(context)
 * await readProcessStart(child.pid!) // => 'linux:16362446'
 */
export async function idleChild(context: TestContext): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  context.after(() => child.kill('SIGKILL'))
  await once(child.stdout, 'data')
  return child
}

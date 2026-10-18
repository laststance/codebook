import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

/**
 * Makes a `ps` of the test's own until the test ends, for a test that needs a process listing that never answers or one of a size it chooses: a directory that holds one executable named `ps`, which runs the given Node.js source with this Node binary. The listing starts `ps` only by an absolute path, so the test names the stand-in's path as the listing's `psPrograms`; the directory is also the whole command search path of this test process meanwhile.
 * The stand-in replaces its shell, so a signal sent to the listing ends the Node.js process itself.
 * It needs a shell at `/bin/sh`: a test that uses it cannot run on Windows.
 * @param context - The test, at whose end the search path is put back and the directory removed.
 * @param source - The Node.js source the stand-in runs instead of listing the processes.
 * @returns The stand-in's absolute path.
 * @example
 * const ps = await standInForPs(context, 'setTimeout(() => {}, 20_000)') // listProcesses({ psPrograms: [ps] }) now prints nothing for 20 s
 */
export async function standInForPs(
  context: TestContext,
  source: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-ps-stand-in-'))
  const searchPathBefore = process.env.PATH
  context.after(async () => {
    process.env.PATH = searchPathBefore
    await rm(directory, { recursive: true, force: true })
  })
  const program = join(directory, 'listing.js'),
    command = join(directory, 'ps')
  await writeFile(program, source)
  await writeFile(
    command,
    `#!/bin/sh\nexec '${process.execPath}' '${program}'\n`,
  )
  await chmod(command, 0o755)
  process.env.PATH = directory
  return command
}

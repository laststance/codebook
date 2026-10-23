import { createServer } from 'node:net'

import { StudyError } from '../errors'

import type { DeclaredDevelopmentPort } from './readDeclaredDevelopmentPort'

/**
 * Refuses the start when something already listens on the project's own port, so the run never falls back to another port.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before the app is started.
 *
 * @param declared - The port and where it was declared ({@link readDeclaredDevelopmentPort}).
 * @throws `PREREQUISITE_MISSING` naming the port, why it matters and the recovery, when the port is in use or cannot be bound.
 *
 * @example
 * ```ts
 * await assertDevelopmentPortFree({ port: 3165, source: 'the dev script in package.json' })
 * ```
 */
export async function assertDevelopmentPortFree(
  declared: DeclaredDevelopmentPort,
): Promise<void> {
  const probe = createServer()
  const failure = await new Promise<NodeJS.ErrnoException | undefined>(
    (resolve) => {
      probe.once('error', resolve)
      probe.listen({ host: '127.0.0.1', port: declared.port }, () =>
        probe.close(() => resolve(undefined)),
      )
    },
  )
  if (!failure) return
  if (failure.code !== 'EADDRINUSE' && failure.code !== 'EACCES') throw failure
  throw new StudyError(
    'PREREQUISITE_MISSING',
    `Port ${declared.port} on 127.0.0.1 is not available, and the project declares it (${declared.source}): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to stop the process that listens on port ${declared.port} (often their own dev server), then start again.`,
  )
}

import {
  apiServerExitedRefusal,
  apiServerListenerNotOwnedRefusal,
  apiServerNotListeningRefusal,
  apiServerPortOwnerUnknownRefusal,
  apiServerPortUnavailableRefusal,
  apiServerRuntimeFailedRefusal,
  apiServerSourceRefusal,
} from '../apiServerRefusals'
import { StudyError } from '../errors'
import type { OwnedApiServerExit } from '../ownedApiServer'

import { findPortOccupant } from './findPortOccupant'

/** The preparation steps of an API start, named in the run resource, the journal and `details.step` (DX-4). */
export type ApiServerStep =
  | 'api-server-check'
  | 'api-server-launch'
  | 'api-server-attach'
  | 'api-server-release'
  | 'api-server-listen'

/** What {@link apiServerRefusalOf} words an error with. */
export interface ApiServerRefusalContext {
  /** The declared `apiServer.port`. */
  port: number
  /** The step that failed. */
  step: ApiServerStep
  /** The failure's words without private paths, for `RUNTIME_FAILED`. */
  cause: string
  /** Where the run journal can be read. */
  journalUri: string
  /** The API's exit fact once it ended; makes `SERVER_EXITED` carry the exit code and the masked tail. */
  exit?: OwnedApiServerExit
}

/**
 * Words an error of the API path as the `apiServer` refusal of its code (DX-3, DX-6, DX-7, DX-10, DX-11).
 *
 * Why it exists: {@link OwnedApiServer} fails with the node-server codes and their node-server words; an `expo-web-dev` run must tell the chat the API's own field names, recovery and help anchor. Called by the run's API preparation for every error it meets after the declaration passed the schema.
 * @param error - What the check, launch, attach or listener wait threw.
 * @param context - The port, step, cause and journal address.
 * @returns The refusal for a node-server code; the error itself when it is some other coded refusal (an Expo or Next code the run owns); `RUNTIME_FAILED` with `details.step` for an uncoded error.
 * @example
 * await apiServerRefusalOf(new StudyError('SERVER_NOT_LISTENING', 'x'), { port: 4100, step: 'api-server-listen', cause: 'x', journalUri: 'events' }) // => StudyError SERVER_NOT_LISTENING with details.step
 */
export async function apiServerRefusalOf(
  error: unknown,
  context: ApiServerRefusalContext,
): Promise<unknown> {
  if (!(error instanceof StudyError))
    return apiServerRuntimeFailedRefusal(
      context.step,
      context.cause,
      context.journalUri,
    )
  switch (error.code) {
    case 'NODE_SERVER_SOURCE_REFUSED':
      return apiServerSourceRefusal(error.message)
    case 'PORT_UNAVAILABLE':
      return apiServerPortUnavailableRefusal(
        context.port,
        await findPortOccupant(context.port).catch(() => undefined),
      )
    case 'LISTENER_NOT_OWNED':
      return apiServerListenerNotOwnedRefusal(error.message, context.port)
    case 'PORT_OWNER_UNKNOWN':
      return apiServerPortOwnerUnknownRefusal(error.message, context.port)
    case 'SERVER_NOT_LISTENING':
      return apiServerNotListeningRefusal(
        context.port,
        context.step,
        listeningPortOf(error.message),
      )
    case 'SERVER_EXITED':
      return context.exit
        ? apiServerExitedRefusal(context.exit, context.exit.outputTail)
        : error
    default:
      return error
  }
}

/**
 * Reads the other port a not-listening message names ("The launched process listens on port 4200").
 * @param message - The `SERVER_NOT_LISTENING` message of the node-server words.
 * @returns The port; `undefined` when the message names none.
 * @example listeningPortOf('… The launched process listens on port 4200: declare port: 4200.') // => 4200
 */
function listeningPortOf(message: string): number | undefined {
  const match = /listens on port (\d+)/.exec(message)
  return match ? Number(match[1]) : undefined
}

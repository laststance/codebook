import type { NodeServerHistoryHeader } from '../nodeServerHistorySchemas'

import { maskNodeServerConfiguration } from './maskNodeServerConfiguration'
import { maskSecretQueryValues } from './maskSecretQueryValues'

/**
 * Masks the request a saved Node server history's header declares, so a history saved before the callback `code` was masked serves no `?code=` or `?token=` value in its configuration or its declared request.
 * Why: the header builder masks the declaration as it saves it, but a header on disk keeps what the version that saved it wrote; {@link readServerHistoryResource} calls this just before it serves the history's own page. The entries have their own mask ({@link maskSavedServerEntries}).
 * @param header - A verified server history header as the store reads it.
 * @returns A copy whose configuration (request path and body) and declared request path are masked again as the header builder masks them; everything else as saved.
 * @example
 * maskSavedServerHeader(header).declaredRequest.path // => '/login/callback?code=[masked]&state=xyz'
 */
export function maskSavedServerHeader(
  header: NodeServerHistoryHeader,
): NodeServerHistoryHeader {
  return {
    ...header,
    configuration: maskNodeServerConfiguration(header.configuration),
    declaredRequest: {
      ...header.declaredRequest,
      path: maskSecretQueryValues(header.declaredRequest.path),
    },
  }
}

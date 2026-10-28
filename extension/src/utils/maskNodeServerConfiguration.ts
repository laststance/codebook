import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'

import { maskNodeServerRequestBody } from './maskNodeServerRequestBody'
import { maskSecretQueryValues } from './maskSecretQueryValues'

/**
 * Masks the secrets a node-server declaration can carry, its request path's query values and its request body's secret-named fields, so the history header stores a declaration that is safe at rest.
 * Called by the node-server run when it builds the history header (pt3); the SHA-256 of the original declaration is kept beside it as identity.
 * @param configuration - The validated declaration.
 * @returns A copy with the request's path and body masked; everything else unchanged.
 * @example maskNodeServerConfiguration(configuration).request.path // => '/api?token=[masked]'
 */
export function maskNodeServerConfiguration(
  configuration: NodeServerConfiguration,
): NodeServerConfiguration {
  const { request } = configuration
  return {
    ...configuration,
    request: {
      ...request,
      path: maskSecretQueryValues(request.path),
      ...(request.body === undefined
        ? {}
        : {
            body: maskNodeServerRequestBody(request.body, request.contentType),
          }),
    },
  }
}

import {
  NODE_SERVER_REQUEST_BODY_LIMIT_BYTES,
  NODE_SERVER_REQUEST_PATH_LIMIT_CHARS,
} from '../constants'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'

import { cutTextToLength } from './cutTextToLength'
import { cutTextToUtf8Bytes } from './cutTextToUtf8Bytes'
import { maskNodeServerRequestBody } from './maskNodeServerRequestBody'
import { maskSecretQueryValues } from './maskSecretQueryValues'

/**
 * Masks the secrets a node-server declaration can carry, its request path's query values and its request body's secret-named fields, so the history header stores a declaration that is safe at rest.
 * Called by {@link buildNodeServerHistoryHeader} when it builds the history header, and by {@link maskSavedServerHeader} when it serves a saved one; the SHA-256 of the original declaration is kept beside it as identity.
 * Why the cut: a mask can lengthen a value (`code=x` reads `code=[masked]`), and the header schema bounds the path ({@link NODE_SERVER_REQUEST_PATH_LIMIT_CHARS} characters) and the body ({@link NODE_SERVER_REQUEST_BODY_LIMIT_BYTES} bytes) the declaration itself is bounded by, so a request that fit the declaration would otherwise leave the run with no history. The cut comes after the mask, never before, so no cut leaves a fragment of a secret; only the stored copy is masked and cut, never the request sent.
 * @param configuration - The validated declaration.
 * @returns A copy with the request's path and body masked and, when the mask lengthened them past their bounds, cut to those bounds; everything else unchanged.
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
      path: cutTextToLength(
        maskSecretQueryValues(request.path),
        NODE_SERVER_REQUEST_PATH_LIMIT_CHARS,
      ),
      ...(request.body === undefined
        ? {}
        : {
            body: cutTextToUtf8Bytes(
              maskNodeServerRequestBody(request.body, request.contentType),
              NODE_SERVER_REQUEST_BODY_LIMIT_BYTES,
            ),
          }),
    },
  }
}

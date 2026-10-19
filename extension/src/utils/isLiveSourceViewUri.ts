import type { Uri } from 'vscode'

import { STUDY_SOURCE_SCHEME } from '../constants'

/**
 * Identifies the live-updating display namespace, including recorded moments for the native reader, provider and pinned-cache guards; callers separately verify workspace ownership.
 * @param uri - Native document scheme and path; a folder named `source-view` inside an immutable source is not a view.
 * @returns Whether the URI identifies an opaque live-updating source input.
 * @example isLiveSourceViewUri({ scheme: 'codebook-source', path: '/source-view/id/Captured-live-source.mts' }) // true
 */
export function isLiveSourceViewUri(
  uri: Pick<Uri, 'scheme' | 'path'>,
): boolean {
  return (
    uri.scheme === STUDY_SOURCE_SCHEME && uri.path.startsWith('/source-view/')
  )
}

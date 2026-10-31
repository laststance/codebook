import type { ExtensionHistoryHeader } from '../chromeExtensionHistorySchemas'
import type { ExtensionHistoryIdentity } from '../chromeExtensionHistorySink'
import { MAX_EXPLANATION_CHARS } from '../constants'

/** What {@link buildExtensionHistoryHeader} reads of the run. */
export type ExtensionHistoryHeaderInput = {
  workspaceKey: string
  instanceId: string
  runId: string
  /** The run's creation time in milliseconds. */
  createdAtMs: number
  identity: ExtensionHistoryIdentity
  repositoryRevision: ExtensionHistoryHeader['repositoryRevision']
}

/**
 * Builds the header a chrome-extension history starts with: the run's identity, the extension (name and version from its manifest), the surface it opened, the declared stops, the repository revision and the Chrome that runs it.
 * Called by {@link startChromeExtensionHistory} once the run's declaration resolved. The question is `Extension run: <name>` until the chat saves its own question with its learning material.
 * @param input - The run's identity and what its declaration resolved to.
 * @returns The header without its `formatVersion`, which the store stamps.
 * @example buildExtensionHistoryHeader(input).question // => 'Extension run: Bookmark Notes'
 */
export function buildExtensionHistoryHeader(
  input: ExtensionHistoryHeaderInput,
): Omit<ExtensionHistoryHeader, 'formatVersion'> {
  const { identity } = input
  return {
    profile: 'chrome-extension',
    workspaceKey: input.workspaceKey,
    studyId: `${input.instanceId}_${input.runId}`,
    instanceId: input.instanceId,
    runId: input.runId,
    createdAt: new Date(input.createdAtMs).toISOString(),
    question: `Extension run: ${identity.extension.name}`.slice(
      0,
      MAX_EXPLANATION_CHARS,
    ),
    extension: identity.extension,
    surface: identity.surface,
    declaredStops: identity.declaredStops.map((stop) => ({ ...stop })),
    repositoryRevision: input.repositoryRevision,
    chrome: { version: identity.chromeVersion },
  }
}

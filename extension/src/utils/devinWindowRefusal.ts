import { DEVIN_WINDOWS_UNSUPPORTED_SENTENCE } from '../constants'
import { DEVIN_REMOTE_UNSUPPORTED_SENTENCE } from '../devinWindowSentences'

/**
 * Says whether Devin Desktop setup is refused in this window, so setup, the activation refresh and the removal refuse through one check before they read the workspace or any file.
 * @param platform - The system the window runs on (`process.platform`).
 * @param remoteName - The editor's `env.remoteName`: set in a WSL, SSH or container window.
 * @returns The one-sentence refusal, or `undefined` when the window is supported.
 * @example
 * devinWindowRefusal('darwin', 'wsl') // => 'Devin Desktop setup in a remote window is not supported yet.'
 */
export function devinWindowRefusal(
  platform: NodeJS.Platform,
  remoteName: string | undefined,
): string | undefined {
  if (platform === 'win32') return DEVIN_WINDOWS_UNSUPPORTED_SENTENCE
  // An empty name is no remote.
  if (remoteName) return DEVIN_REMOTE_UNSUPPORTED_SENTENCE
  return undefined
}

import {
  llmWikiFolderMissingNotice,
  llmWikiFolderRemoteNotice,
} from '../constants'

/**
 * Words why Reveal Wiki Folder opens nothing, so the learner is not left with a command that does nothing visible.
 *
 * Why: the editor's reveal command opens folders of this computer only and shows nothing for a missing one.
 * Trigger: the LLM Wiki view's Reveal Wiki Folder command asks it before it reveals the folder.
 *
 * @param folder - What is known of the Wiki folder.
 * @param folder.outputLabel - The folder as the learner reads it (project-relative or absolute).
 * @param folder.exists - Whether the folder exists now.
 * @param folder.remoteName - The editor's `env.remoteName`; empty or absent for a local window.
 * @returns
 * - A missing folder: `The LLM Wiki folder <label> does not exist (yet).`
 * - An existing folder in a remote window: `Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on <remote name>.`
 * - Otherwise `undefined`: the folder can be revealed.
 * @example
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', exists: false }) // => 'The LLM Wiki folder .codebook/wiki does not exist (yet).'
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', exists: true, remoteName: 'wsl' }) // => 'Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on wsl.'
 */
export function describeUnrevealableWikiFolder(folder: {
  outputLabel: string
  exists: boolean
  remoteName?: string
}): string | undefined {
  // A missing folder is the more useful answer, in a remote window too.
  if (!folder.exists) return llmWikiFolderMissingNotice(folder.outputLabel)
  if (folder.remoteName) return llmWikiFolderRemoteNotice(folder.remoteName)
  return undefined
}

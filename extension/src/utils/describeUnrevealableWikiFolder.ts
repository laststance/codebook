import {
  llmWikiFolderIsFileNotice,
  llmWikiFolderMissingNotice,
  llmWikiFolderRemoteNotice,
  WSL_REMOTE_NAME,
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
 * @param folder.isFile - Whether a file stands at the path instead (only read when the folder does not exist).
 * @param folder.remoteName - The editor's `env.remoteName`; empty or absent for a local window. A WSL window counts as a local one, as everywhere in Codebook.
 * @returns
 * - A file in the folder's place: `The LLM Wiki folder <label> is a file, not a folder. Remove or rename that file, or change the location.`
 * - A missing folder: `The LLM Wiki folder <label> does not exist (yet). Generate LLM Wiki creates it.`
 * - An existing folder in a remote window other than WSL: `Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on <remote name>. Open it from a terminal or file manager on <remote name>.`
 * - Otherwise `undefined`: the folder can be revealed.
 * @example
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', exists: false }) // => 'The LLM Wiki folder .codebook/wiki does not exist (yet). Generate LLM Wiki creates it.'
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', exists: true, remoteName: 'ssh-remote' }) // => 'Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on ssh-remote. Open it from a terminal or file manager on ssh-remote.'
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', exists: true, remoteName: 'wsl' }) // => undefined
 */
export function describeUnrevealableWikiFolder(folder: {
  outputLabel: string
  exists: boolean
  isFile?: boolean
  remoteName?: string
}): string | undefined {
  // A missing folder or a file in its place is the more useful answer, in a remote window too.
  if (!folder.exists) {
    return folder.isFile
      ? llmWikiFolderIsFileNotice(folder.outputLabel)
      : llmWikiFolderMissingNotice(folder.outputLabel)
  }
  // A WSL window reveals as a local one: the editor's reveal works there.
  if (folder.remoteName && folder.remoteName !== WSL_REMOTE_NAME)
    return llmWikiFolderRemoteNotice(folder.remoteName)
  return undefined
}

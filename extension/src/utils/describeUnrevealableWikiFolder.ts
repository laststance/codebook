import {
  llmWikiFolderDanglingLinkNotice,
  llmWikiFolderIsFileNotice,
  llmWikiFolderMissingNotice,
  llmWikiFolderRemoteNotice,
  llmWikiFolderUnreadableNotice,
  WSL_REMOTE_NAME,
} from '../constants'

import type { WikiFolderKind } from './wikiFolderKindOf'

/**
 * Words why Reveal Wiki Folder opens nothing, so the learner is not left with a command that does nothing visible.
 *
 * Why: the editor's reveal command opens folders of this computer only and shows nothing for a missing one.
 * Trigger: the LLM Wiki view's Reveal Wiki Folder command asks it before it reveals the folder.
 *
 * @param folder - What is known of the Wiki folder.
 * @param folder.outputLabel - The folder as the learner reads it (project-relative or absolute).
 * @param folder.folderKind - What stands at the path now ({@link wikiFolderKindOf}).
 * @param folder.remoteName - The editor's `env.remoteName`; empty or absent for a local window. A WSL window counts as a local one, as everywhere in Codebook.
 * @returns
 * - A file in the folder's place: `The LLM Wiki folder <label> is a file, not a folder. Remove or rename that file, or change the location.`
 * - A link whose target is missing: `The LLM Wiki folder <label> is a link whose target is missing. Remove or fix the link, or change the location.`
 * - A path that cannot be read (or did not answer in time, `ETIMEDOUT`): `The LLM Wiki folder <label> cannot be read (<code>). Check the path and its permissions, or change the location.`
 * - A missing folder: `The LLM Wiki folder <label> does not exist (yet). Generate LLM Wiki creates it.`
 * - An existing folder in a remote window other than WSL: `Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on <remote name>. Open it from a terminal in this window, which runs in that remote environment, not on this computer.`
 * - Otherwise `undefined`: the folder can be revealed.
 * @example
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', folderKind: { kind: 'missing' } }) // => 'The LLM Wiki folder .codebook/wiki does not exist (yet). Generate LLM Wiki creates it.'
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', folderKind: { kind: 'folder' }, remoteName: 'ssh-remote' }) // => 'Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on ssh-remote. Open it from a terminal in this window, which runs in that remote environment, not on this computer.'
 * describeUnrevealableWikiFolder({ outputLabel: '.codebook/wiki', folderKind: { kind: 'folder' }, remoteName: 'wsl' }) // => undefined
 */
export function describeUnrevealableWikiFolder(folder: {
  outputLabel: string
  folderKind: WikiFolderKind
  remoteName?: string
}): string | undefined {
  const { folderKind, outputLabel } = folder
  // A missing, unreadable or file path is the more useful answer, in a remote window too.
  if (folderKind.kind === 'file') return llmWikiFolderIsFileNotice(outputLabel)
  if (folderKind.kind === 'missing')
    return llmWikiFolderMissingNotice(outputLabel)
  if (folderKind.kind === 'dangling-link')
    return llmWikiFolderDanglingLinkNotice(outputLabel)
  if (folderKind.kind === 'unreadable')
    return llmWikiFolderUnreadableNotice(outputLabel, folderKind.code)
  // A WSL window reveals as a local one: the editor's reveal works there.
  if (folder.remoteName && folder.remoteName !== WSL_REMOTE_NAME)
    return llmWikiFolderRemoteNotice(folder.remoteName)
  return undefined
}

import * as fileSystem from 'node:fs/promises'
import { sep } from 'node:path'

export * from 'node:fs/promises'

/** The other name a test gave a folder and the folder it names; undefined while none is given. */
let alias

/**
 * Gives a folder another name beside it, as a file system does that ignores the case of names (macOS, Windows) or that takes a short name or a name with a trailing dot for the same entry (Windows): every call of this module for the other name, or for a path below it, goes to the folder, as one folder answers to both names there. Called by the publisher's tests before they recover a Wiki with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {string | undefined} otherName - The other name, as a whole path; `undefined` to give none.
 * @param {string} [folder] - The folder it names.
 * @returns {void}
 * @example
 * nameFolderAlso('/repo/.codebook/WIKI', '/repo/.codebook/wiki')
 */
export function nameFolderAlso(otherName, folder) {
  alias = otherName === undefined ? undefined : { otherName, folder }
}

/**
 * The path a call goes to: the folder of {@link nameFolderAlso} for its other name or a path below it, the path itself otherwise.
 * @param {string | URL} path - The call's path.
 * @returns {string | URL} The path the call goes to.
 * @example
 * pathOf('/repo/.codebook/WIKI/manual.txt') // => '/repo/.codebook/wiki/manual.txt' after nameFolderAlso('/repo/.codebook/WIKI', '/repo/.codebook/wiki')
 */
function pathOf(path) {
  const text = String(path)
  // Only the other name and the paths below it go elsewhere.
  if (alias === undefined) return path
  if (text === alias.otherName) return alias.folder
  if (text.startsWith(alias.otherName + sep))
    return alias.folder + text.slice(alias.otherName.length)
  return path
}

/**
 * Makes a call of `node:fs/promises` whose first argument is a path go to the path of {@link pathOf}; every other argument is handed on unchanged.
 * @param {(path: string | URL, ...rest: unknown[]) => Promise<unknown>} call - The call of `node:fs/promises`.
 * @returns {(path: string | URL, ...rest: unknown[]) => Promise<unknown>} The call through the other name.
 * @example
 * await throughOtherName(fileSystem.lstat)('/repo/.codebook/WIKI') // => the status of /repo/.codebook/wiki
 */
const throughOtherName =
  (call) =>
  (path, ...rest) =>
    call(pathOf(path), ...rest)

export const lstat = throughOtherName(fileSystem.lstat)
export const stat = throughOtherName(fileSystem.stat)
export const realpath = throughOtherName(fileSystem.realpath)
export const readdir = throughOtherName(fileSystem.readdir)
export const readFile = throughOtherName(fileSystem.readFile)
export const readlink = throughOtherName(fileSystem.readlink)
export const open = throughOtherName(fileSystem.open)
export const writeFile = throughOtherName(fileSystem.writeFile)
export const unlink = throughOtherName(fileSystem.unlink)
export const mkdir = throughOtherName(fileSystem.mkdir)
export const rmdir = throughOtherName(fileSystem.rmdir)

/**
 * Moves a folder or file as `rename` does, each of its two paths through {@link pathOf}.
 * @param {string} from - What is moved.
 * @param {string} to - Where it goes.
 * @returns {Promise<void>} What `rename` answers.
 * @example
 * await rename('/repo/.codebook/WIKI', '/repo/.codebook/wiki.previous-1') // moves /repo/.codebook/wiki
 */
export function rename(from, to) {
  return fileSystem.rename(pathOf(from), pathOf(to))
}

import * as fileSystem from 'node:fs/promises'
import { sep } from 'node:path'

export * from 'node:fs/promises'

/** The other name a test gave a folder, the folder it names, and whether every status answers a file id of 0; undefined while none is given. */
let alias

/**
 * Gives a folder another name beside it, as a file system does that ignores the case of names (macOS, Windows) or that takes a short name or a name with a trailing dot for the same entry (Windows): every call of this module for the other name, or for a path below it, goes to the folder, as one folder answers to both names there. Called by the publisher's tests before they recover a Wiki with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {string | undefined} otherName - The other name, as a whole path; `undefined` to give none.
 * @param {string} [folder] - The folder it names.
 * @param {{ hasNoFileIds?: boolean }} [volume] - `hasNoFileIds`: every `lstat` and `stat` of this module answers a file id (`ino`) of 0, as some SMB and FAT volumes do for every entry.
 * @returns {void}
 * @example
 * nameFolderAlso('/repo/.codebook/WIKI', '/repo/.codebook/wiki', { hasNoFileIds: true })
 */
export function nameFolderAlso(
  otherName,
  folder,
  { hasNoFileIds = false } = {},
) {
  alias =
    otherName === undefined ? undefined : { otherName, folder, hasNoFileIds }
}

/**
 * The status a call of this module answers: the status itself, with a file id of 0 while {@link nameFolderAlso} gave a volume without file ids.
 * @param {import('node:fs').Stats | import('node:fs').BigIntStats} status - What `lstat` or `stat` answered.
 * @returns {import('node:fs').Stats | import('node:fs').BigIntStats} The status as this volume answers it.
 * @example
 * statusAsAnswered(await fileSystem.lstat('/repo/.codebook/wiki', { bigint: true })).ino // => 0n after nameFolderAlso(…, { hasNoFileIds: true })
 */
function statusAsAnswered(status) {
  // A volume without file ids answers 0 for every entry, in the type the caller asked for.
  if (alias?.hasNoFileIds) status.ino = typeof status.ino === 'bigint' ? 0n : 0
  return status
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

export const lstat = (path, ...rest) =>
  throughOtherName(fileSystem.lstat)(path, ...rest).then(statusAsAnswered)
export const stat = (path, ...rest) =>
  throughOtherName(fileSystem.stat)(path, ...rest).then(statusAsAnswered)
export const realpath = throughOtherName(fileSystem.realpath)
export const readdir = throughOtherName(fileSystem.readdir)
export const readFile = throughOtherName(fileSystem.readFile)
export const readlink = throughOtherName(fileSystem.readlink)
/**
 * Opens a file as `open` does, through the path of {@link pathOf}; the status read through its handle answers as `lstat` does ({@link statusAsAnswered}), since a volume without file ids answers 0 for a handle's status too.
 * @param {string | URL} path - The file to open.
 * @param {...unknown} rest - The caller's flags and mode, handed on unchanged.
 * @returns {Promise<import('node:fs/promises').FileHandle>} The handle, whose `stat` answers as this volume does.
 * @example
 * (await (await open('/repo/.codebook/WIKI/manual.txt', 'r')).stat({ bigint: true })).ino // => 0n after nameFolderAlso(…, { hasNoFileIds: true })
 */
export async function open(path, ...rest) {
  const handle = await throughOtherName(fileSystem.open)(path, ...rest)
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'stat')
        return (...options) => target.stat(...options).then(statusAsAnswered)
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
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

/**
 * Gives a file a second name as `link` does, each of its two paths through {@link pathOf}, as {@link rename} moves: the publisher gives a journal, a claim or a lock its name with a hard link.
 * @param {string} existingPath - The file.
 * @param {string} newPath - Its new name.
 * @returns {Promise<void>} What `link` answers.
 * @example
 * await link('/repo/.codebook/WIKI/a.txt', '/repo/.codebook/WIKI/b.txt') // gives /repo/.codebook/wiki/a.txt the name /repo/.codebook/wiki/b.txt
 */
export function link(existingPath, newPath) {
  return fileSystem.link(pathOf(existingPath), pathOf(newPath))
}

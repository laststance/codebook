import * as fileSystem from 'node:fs/promises'

export * from 'node:fs/promises'

/** The base of the file ids the stand-in gives the folder a test names: 2^60, far above the 2^53 a JavaScript number holds exactly. */
const LARGE_FILE_ID = 2n ** 60n

/** The folder whose ids the stand-in replaces, the folder whose `mkdir` changes them, and how often they changed. */
const watched = { folder: undefined, changedBefore: undefined, generation: 1n }

/**
 * Gives a folder a device id and a file id above 2^53, as NTFS can, and changes its file id in its low bits once `mkdir` makes `changedBefore`, as when another folder of the project took its place between the publisher's look and its write. As JavaScript numbers the two file ids are the same; as bigints they differ. Called by the publisher's tests before they prepare or publish with the copy that gets this module as its `node:fs/promises` (the loader hook of `markedCopyHooks.mjs`, by its mark).
 * @param {string | undefined} folder - The folder whose ids are replaced; `undefined` for none.
 * @param {string} [changedBefore] - The folder whose `mkdir` changes the file id first.
 * @returns {void}
 * @example
 * giveLargeFileIds('/repo/.codebook', '/repo/.codebook/next')
 */
export function giveLargeFileIds(folder, changedBefore) {
  Object.assign(watched, { folder, changedBefore, generation: 1n })
}

/**
 * Answers a folder's status as `stat` does, with the large ids of {@link giveLargeFileIds} for the folder it names: as bigints when the caller asks for them, as JavaScript numbers otherwise.
 * @param {string} path - The path.
 * @param {{ bigint?: boolean }} [options] - The caller's options.
 * @returns {Promise<import('node:fs').Stats | import('node:fs').BigIntStats>} The status.
 * @example
 * (await stat('/repo/.codebook', { bigint: true })).ino // => 1152921504606846977n
 */
export async function stat(path, options) {
  const status = await fileSystem.stat(path, options)
  if (String(path) !== watched.folder) return status
  const toKind = options?.bigint ? (id) => id : Number
  return Object.assign(Object.create(Object.getPrototypeOf(status)), status, {
    dev: toKind(LARGE_FILE_ID),
    ino: toKind(LARGE_FILE_ID + watched.generation),
  })
}

/**
 * Makes a folder as `mkdir` does, and changes the watched folder's file id first when this is the folder of {@link giveLargeFileIds}.
 * @param {string} path - The folder to make.
 * @param {...unknown} options - The caller's options, handed on unchanged.
 * @returns {Promise<string | undefined>} What `mkdir` answers.
 * @example
 * await mkdir('/repo/.codebook/next', { recursive: true })
 */
export async function mkdir(path, ...options) {
  // The file id changes in its low bits, once.
  if (String(path) === watched.changedBefore && watched.generation === 1n)
    watched.generation = 2n
  return fileSystem.mkdir(path, ...options)
}

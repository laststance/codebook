import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import {
  LIBRARY_BUILD_ENTRY_LIMIT_COUNT,
  LIBRARY_LINK_DEPTH_LIMIT,
  LIBRARY_LINK_FOLDER_LIMIT_COUNT,
} from '../constants'

import { isAtOrInsideFolder } from './isAtOrInsideFolder'
import { linksToRealFolder } from './linksToRealFolder'

/** Lists a folder's entries within the per-listing bound; a missing or unreadable folder is empty and an over-bound one is `undefined`. */
async function listNames(
  folder: string,
  signal: AbortSignal | undefined,
): Promise<{ name: string; isDirectory: boolean }[] | undefined> {
  const names: { name: string; isDirectory: boolean }[] = []
  try {
    for await (const entry of await opendir(folder)) {
      signal?.throwIfAborted()
      if (names.length >= LIBRARY_BUILD_ENTRY_LIMIT_COUNT) return undefined
      names.push({ name: entry.name, isDirectory: entry.isDirectory() })
    }
  } catch (error) {
    // An abort is the run's stop, not a missing folder.
    if (signal?.aborted) throw error
    return names
  }
  return names
}

/** Lists the entry names of `<folder>/node_modules`, scoped ones as `@scope/name`; `undefined` when a listing passes its bound. */
async function listPackageNames(
  modules: string,
  signal: AbortSignal | undefined,
): Promise<string[] | undefined> {
  const top = await listNames(modules, signal)
  if (top === undefined) return undefined
  const names: string[] = []
  for (const entry of top) {
    // A real scope folder is listed one level deeper; every other real folder (`.pnpm`, `.bin`) is installed content, never followed.
    if (entry.isDirectory && entry.name.startsWith('@')) {
      const scoped = await listNames(join(modules, entry.name), signal)
      if (scoped === undefined) return undefined
      names.push(...scoped.map((inner) => join(entry.name, inner.name)))
    } else {
      names.push(entry.name)
    }
  }
  return names
}

/** Gives the real folder of a `node_modules` entry when it is a workspace link: a link to a package folder inside the repository, outside every `node_modules`. */
async function workspacePackageOf(
  root: string,
  path: string,
): Promise<string | undefined> {
  try {
    // Only a link is a workspace link.
    if (!(await lstat(path)).isSymbolicLink()) return undefined
    const real = await realpath(path)
    // A package below any `node_modules` (a pnpm store or installed package) is never followed.
    const isWorkspaceFolder =
      isAtOrInsideFolder(root, real) &&
      !relative(root, real).split(sep).includes('node_modules')
    return isWorkspaceFolder &&
      (await stat(join(real, 'package.json'))).isFile()
      ? real
      : undefined
  } catch {
    // A broken link or a folder without package.json is no workspace package.
    return undefined
  }
}

/** Gives the package folders `<folder>/node_modules` links to (see {@link workspacePackageOf}); `undefined` when a listing passes its bound. */
async function linkedPackageFolders(
  root: string,
  folder: string,
  signal: AbortSignal | undefined,
): Promise<string[] | undefined> {
  const modules = join(folder, 'node_modules')
  const names = await listPackageNames(modules, signal)
  if (names === undefined) return undefined
  const folders: string[] = []
  for (const name of names) {
    signal?.throwIfAborted()
    const real = await workspacePackageOf(root, join(modules, name))
    if (real !== undefined) folders.push(real)
  }
  return folders
}

/** Gives the package folders to visit after `folder` found at `depth`: none at the last depth, which only checks. */
async function followLinks(
  root: string,
  folder: string,
  depth: number,
  signal: AbortSignal | undefined,
): Promise<string[] | undefined> {
  if (depth + 1 >= LIBRARY_LINK_DEPTH_LIMIT) return []
  return linkedPackageFolders(root, folder, signal)
}

/**
 * Says whether the app reaches a library folder through `node_modules` links the way Node resolves them: directly, or through a chain of workspace packages that link to one another.
 *
 * Why it exists: pnpm links an app's workspace dependency (`react-query`) into the app, and that package links its own dependency (`query-core`) into itself, so the library is in neither the app's nor the root `node_modules`. Called by `libraryOfFile` in `libraryBuildStop.ts` for the library candidate of a stop file.
 * @param root - The real repository root; no link leaving it is followed.
 * @param appFolder - The app folder where the walk starts.
 * @param name - The library's npm name.
 * @param libraryFolder - The library's real folder.
 * @param signal - The run's abort signal, checked between folders and entries.
 * @returns `true` when some reached package folder's `node_modules/<name>` resolves to the library; `false` otherwise, also when {@link LIBRARY_LINK_DEPTH_LIMIT}, {@link LIBRARY_LINK_FOLDER_LIMIT_COUNT} or the listing bound is exceeded.
 * @example
 * await appReachesLibrary(root, join(root, 'examples/app'), '@s/core', join(root, 'packages/core')) // => true for app -> react-lib -> core
 */
export async function appReachesLibrary(
  root: string,
  appFolder: string,
  name: string,
  libraryFolder: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const visited = new Set<string>()
  let level = [appFolder]
  // Each pass follows one more link; the last link to the library counts as one.
  for (let depth = 0; depth < LIBRARY_LINK_DEPTH_LIMIT; depth += 1) {
    const next: string[] = []
    for (const folder of level) {
      signal?.throwIfAborted()
      // A folder is visited once, so a link cycle ends.
      if (visited.has(folder)) continue
      visited.add(folder)
      if (visited.size > LIBRARY_LINK_FOLDER_LIMIT_COUNT) return false
      if (await linksToRealFolder(folder, name, libraryFolder)) return true
      const linked = await followLinks(root, folder, depth, signal)
      if (linked === undefined) return false
      next.push(...linked)
    }
    level = next
  }
  return false
}

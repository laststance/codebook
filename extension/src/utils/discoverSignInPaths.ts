import type { Dirent } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  NEXT_PAGES_SOURCE_EXTENSIONS,
  SIGN_IN_PATH_CANDIDATES,
  SIGN_IN_PATH_SCAN_FILE_BYTES,
  SIGN_IN_PATH_SCAN_FILE_LIMIT,
} from '../constants'
import type { DevelopmentServerAdapterName } from '../developmentServerAdapter'

import { findNextRouteFolder } from './findNextRouteFolder'
import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { isUnlinkedRegularFile } from './isUnlinkedRegularFile'

/** The source file kinds a Vite sign-in path scan reads. */
const VITE_SOURCE_PATTERN = /\.(?:tsx?|jsx?|vue|svelte)$/

/** Says whether any default-extension page file exists at `<base>.<ext>`, links never followed; a path whose status cannot be read (permission, I/O) counts as no file. */
async function hasSourceWithExtension(
  packageRoot: string,
  base: string,
): Promise<boolean> {
  for (const extension of NEXT_PAGES_SOURCE_EXTENSIONS)
    if (
      // Discovery only orders the offered paths, so an unreadable folder hides its route instead of failing the setup command.
      await isUnlinkedRegularFile(packageRoot, `${base}.${extension}`).catch(
        () => false,
      )
    )
      return true
  return false
}

/** Lists the top-level route groups (`(auth)`) of an App folder; none when it cannot be read. */
async function routeGroupsOf(
  packageRoot: string,
  appFolder: string,
): Promise<string[]> {
  const entries = await readdir(join(packageRoot, appFolder), {
    withFileTypes: true,
  }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
    .map((entry) => entry.name)
}

/** Says whether a Next app at the package root has a page for the candidate in the App Router (directly or under one route group). */
async function hasAppPage(
  packageRoot: string,
  appFolder: string | undefined,
  groups: readonly string[],
  segments: string,
): Promise<boolean> {
  if (appFolder === undefined) return false
  for (const prefix of ['', ...groups.map((group) => `${group}/`)])
    if (
      await hasSourceWithExtension(
        packageRoot,
        `${appFolder}/${prefix}${segments}/page`,
      )
    )
      return true
  return false
}

/** Says whether a Next app at the package root has a Pages Router file for the candidate (`<segments>.ext` or `<segments>/index.ext`). */
async function hasPagesFile(
  packageRoot: string,
  pagesFolder: string | undefined,
  segments: string,
): Promise<boolean> {
  if (pagesFolder === undefined) return false
  return (
    (await hasSourceWithExtension(packageRoot, `${pagesFolder}/${segments}`)) ||
    (await hasSourceWithExtension(
      packageRoot,
      `${pagesFolder}/${segments}/index`,
    ))
  )
}

/** Finds the candidates a Next app at the package root has a route for, in candidate order. */
async function discoverNextSignInPaths(packageRoot: string): Promise<string[]> {
  const appFolder = await findNextRouteFolder(packageRoot, 'app')
  const pagesFolder = await findNextRouteFolder(packageRoot, 'pages')
  const groups = appFolder ? await routeGroupsOf(packageRoot, appFolder) : []
  const found: string[] = []
  for (const candidate of SIGN_IN_PATH_CANDIDATES) {
    const segments = candidate.slice(1)
    if (
      (await hasAppPage(packageRoot, appFolder, groups, segments)) ||
      (await hasPagesFile(packageRoot, pagesFolder, segments))
    )
      found.push(candidate)
  }
  return found
}

/** Lists one folder of the Vite scan only when a real folder stands at its own path ({@link isFolderOfItsOwn}), so a linked `src` (or a junction below it) never leads the scan out of the repository; none when it cannot be read. */
async function ownFolderEntries(
  packageRoot: string,
  folder: string,
): Promise<Dirent[]> {
  const path = join(packageRoot, folder)
  // A link or a junction at the folder's own path leads elsewhere: nothing behind it is listed.
  if (!(await isFolderOfItsOwn(path).catch(() => false))) return []
  return readdir(path, { withFileTypes: true }).catch(() => [])
}

/** Walks `src/` breadth-first without following any link, not even a `src` that is one, up to the file limit; skips `node_modules` and dot folders. */
async function viteSourceFiles(
  packageRoot: string,
  signal: AbortSignal,
): Promise<string[]> {
  const files: string[] = []
  const queue = ['src']
  while (queue.length > 0 && files.length < SIGN_IN_PATH_SCAN_FILE_LIMIT) {
    signal.throwIfAborted()
    const folder = queue.shift() ?? ''
    for (const entry of await ownFolderEntries(packageRoot, folder)) {
      const relative = `${folder}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.'))
          queue.push(relative)
      } else if (
        entry.isFile() &&
        VITE_SOURCE_PATTERN.test(entry.name) &&
        files.length < SIGN_IN_PATH_SCAN_FILE_LIMIT
      )
        files.push(relative)
    }
  }
  return files
}

/** Reads at most the byte limit of a regular, unlinked file as text; empty when it cannot be read. */
async function boundedText(
  packageRoot: string,
  relative: string,
): Promise<string> {
  const path = join(packageRoot, relative)
  const status = await lstat(path).catch(() => undefined)
  if (!status?.isFile()) return ''
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return ''
  try {
    const buffer = Buffer.alloc(SIGN_IN_PATH_SCAN_FILE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Finds the candidates a Vite app's `src/` names as a quoted literal, in candidate order. */
async function discoverViteSignInPaths(
  packageRoot: string,
  signal: AbortSignal,
): Promise<string[]> {
  const remaining = new Set<string>(SIGN_IN_PATH_CANDIDATES)
  const found = new Set<string>()
  for (const relative of await viteSourceFiles(packageRoot, signal)) {
    signal.throwIfAborted()
    const text = await boundedText(packageRoot, relative)
    for (const candidate of remaining)
      if (
        [`'${candidate}'`, `"${candidate}"`, `\`${candidate}\``].some(
          (literal) => text.includes(literal),
        )
      ) {
        found.add(candidate)
        remaining.delete(candidate)
      }
  }
  return SIGN_IN_PATH_CANDIDATES.filter((candidate) => found.has(candidate))
}

/**
 * Finds which of the usual sign-in paths the app at the package root has, so the setup offers the app's own route first.
 * Called by the Set Up Saved Session command before it asks where the app signs in (DX-14).
 * Next: a page file at the path in the App Router (directly or under one top-level route group) or the Pages Router; links are never followed. Vite has no route files, so a bounded scan of `src/` looks for the path as a quoted literal; a `src` that is a link (or any folder below it that leads elsewhere) is not read. A folder or file that cannot be read counts as having no route, so discovery never fails the setup.
 * @param packageRoot - The root of the app whose routes are read: the package root (D11). Saved-session setup runs for the root app, so its caller passes the repository root, which is the package root of a root run; a package below the root has no saved session in this version.
 * @param adapter - The repository's development server adapter.
 * @param signal - Ends the scan.
 * @returns The paths found, in the order of {@link SIGN_IN_PATH_CANDIDATES}; empty when none is.
 * @example
 * await discoverSignInPaths('/repo', 'next-dev-webpack', signal) // => ['/login', '/sign-in'] with app/login/page.tsx and app/(auth)/sign-in/page.tsx
 */
export async function discoverSignInPaths(
  packageRoot: string,
  adapter: DevelopmentServerAdapterName,
  signal: AbortSignal,
): Promise<string[]> {
  return adapter === 'vite-dev'
    ? discoverViteSignInPaths(packageRoot, signal)
    : discoverNextSignInPaths(packageRoot)
}

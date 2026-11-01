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
import { isUnlinkedRegularFile } from './isUnlinkedRegularFile'

/** The source file kinds a Vite sign-in path scan reads. */
const VITE_SOURCE_PATTERN = /\.(?:tsx?|jsx?|vue|svelte)$/

/** Says whether any default-extension page file exists at `<base>.<ext>`, links never followed; a path whose status cannot be read (permission, I/O) counts as no file. */
async function hasSourceWithExtension(
  workspace: string,
  base: string,
): Promise<boolean> {
  for (const extension of NEXT_PAGES_SOURCE_EXTENSIONS)
    if (
      // Discovery only orders the offered paths, so an unreadable folder hides its route instead of failing the setup command.
      await isUnlinkedRegularFile(workspace, `${base}.${extension}`).catch(
        () => false,
      )
    )
      return true
  return false
}

/** Lists the top-level route groups (`(auth)`) of an App folder; none when it cannot be read. */
async function routeGroupsOf(
  workspace: string,
  appFolder: string,
): Promise<string[]> {
  const entries = await readdir(join(workspace, appFolder), {
    withFileTypes: true,
  }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
    .map((entry) => entry.name)
}

/** Says whether a Next workspace has a page for the candidate in the App Router (directly or under one route group). */
async function hasAppPage(
  workspace: string,
  appFolder: string | undefined,
  groups: readonly string[],
  segments: string,
): Promise<boolean> {
  if (appFolder === undefined) return false
  for (const prefix of ['', ...groups.map((group) => `${group}/`)])
    if (
      await hasSourceWithExtension(
        workspace,
        `${appFolder}/${prefix}${segments}/page`,
      )
    )
      return true
  return false
}

/** Says whether a Next workspace has a Pages Router file for the candidate (`<segments>.ext` or `<segments>/index.ext`). */
async function hasPagesFile(
  workspace: string,
  pagesFolder: string | undefined,
  segments: string,
): Promise<boolean> {
  if (pagesFolder === undefined) return false
  return (
    (await hasSourceWithExtension(workspace, `${pagesFolder}/${segments}`)) ||
    (await hasSourceWithExtension(
      workspace,
      `${pagesFolder}/${segments}/index`,
    ))
  )
}

/** Finds the candidates a Next workspace has a route for, in candidate order. */
async function discoverNextSignInPaths(workspace: string): Promise<string[]> {
  const appFolder = await findNextRouteFolder(workspace, 'app')
  const pagesFolder = await findNextRouteFolder(workspace, 'pages')
  const groups = appFolder ? await routeGroupsOf(workspace, appFolder) : []
  const found: string[] = []
  for (const candidate of SIGN_IN_PATH_CANDIDATES) {
    const segments = candidate.slice(1)
    if (
      (await hasAppPage(workspace, appFolder, groups, segments)) ||
      (await hasPagesFile(workspace, pagesFolder, segments))
    )
      found.push(candidate)
  }
  return found
}

/** Walks `src/` breadth-first without following links, up to the file limit; skips `node_modules` and dot folders. */
async function viteSourceFiles(
  workspace: string,
  signal: AbortSignal,
): Promise<string[]> {
  const files: string[] = []
  const queue = ['src']
  while (queue.length > 0 && files.length < SIGN_IN_PATH_SCAN_FILE_LIMIT) {
    signal.throwIfAborted()
    const folder = queue.shift() ?? ''
    const entries = await readdir(join(workspace, folder), {
      withFileTypes: true,
    }).catch(() => [])
    for (const entry of entries) {
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
  workspace: string,
  relative: string,
): Promise<string> {
  const path = join(workspace, relative)
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

/** Finds the candidates a Vite workspace's `src/` names as a quoted literal, in candidate order. */
async function discoverViteSignInPaths(
  workspace: string,
  signal: AbortSignal,
): Promise<string[]> {
  const remaining = new Set<string>(SIGN_IN_PATH_CANDIDATES)
  const found = new Set<string>()
  for (const relative of await viteSourceFiles(workspace, signal)) {
    signal.throwIfAborted()
    const text = await boundedText(workspace, relative)
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
 * Finds which of the usual sign-in paths the repository has, so the setup offers the app's own route first.
 * Called by the Set Up Saved Session command before it asks where the app signs in (DX-14).
 * Next: a page file at the path in the App Router (directly or under one top-level route group) or the Pages Router; links are never followed. Vite has no route files, so a bounded scan of `src/` looks for the path as a quoted literal. A folder or file that cannot be read counts as having no route, so discovery never fails the setup.
 * @param workspace - The opened repository.
 * @param adapter - The repository's development server adapter.
 * @param signal - Ends the scan.
 * @returns The paths found, in the order of {@link SIGN_IN_PATH_CANDIDATES}; empty when none is.
 * @example
 * await discoverSignInPaths('/repo', 'next-dev-webpack', signal) // => ['/login', '/sign-in'] with app/login/page.tsx and app/(auth)/sign-in/page.tsx
 */
export async function discoverSignInPaths(
  workspace: string,
  adapter: DevelopmentServerAdapterName,
  signal: AbortSignal,
): Promise<string[]> {
  return adapter === 'vite-dev'
    ? discoverViteSignInPaths(workspace, signal)
    : discoverNextSignInPaths(workspace)
}

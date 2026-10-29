import { readFile, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { EXTENSION_STATIC_LOAD_DEPTH_LIMIT } from '../constants'

import { extensionFileUrl } from './extensionFileUrl'
import {
  findExtensionImportReferences,
  type ScriptLoadMode,
  type UnfollowedLoadForm,
} from './findExtensionImportReferences'
import { findExtensionScriptReferences } from './findExtensionScriptReferences'
import { isInsideFolder } from './isInsideFolder'
import { resolveExtensionReference } from './resolveExtensionReference'

/** Where discovery starts: the surface page's HTML, or the service worker script with its load mode. */
export type StaticLoadEntry =
  | { kind: 'page'; htmlPath: string }
  | { kind: 'worker'; scriptPath: string; isModule: boolean }

/** A load form discovery saw but does not follow, with the extension-relative file it was in. */
export interface UnfollowedLoad {
  form: UnfollowedLoadForm
  path: string
}

/** Everything an entry statically loads, and what it loads in ways discovery does not follow. */
export interface StaticLoads {
  /** Absolute paths of the entry (a worker script) and every script file reached. A page's HTML is not included. */
  reachable: ReadonlySet<string>
  unfollowed: readonly UnfollowedLoad[]
}

interface QueuedFile {
  relativePath: string
  depth: number
}

/** Converts an absolute path under the root to the forward-slash relative path references use. */
function relativeToRoot(extensionRoot: string, absolutePath: string): string {
  return relative(extensionRoot, absolutePath).split(sep).join('/')
}

/** Reads a file as text, or `undefined` when it is missing or not a readable file. */
async function readText(absolutePath: string): Promise<string | undefined> {
  return readFile(absolutePath, 'utf8').catch(() => undefined)
}

/** What one discovery accumulates: reached files, unfollowed forms, and the breadth-first queue with its enqueued set. */
interface DiscoveryState {
  extensionRoot: string
  /** Real files must stay inside this folder to count as loaded (the repository, else the extension root). */
  confinementRoot: string
  extensionId: string
  reachable: Set<string>
  unfollowed: Map<string, UnfollowedLoad>
  enqueued: Set<string>
  queue: QueuedFile[]
}

/** Records load forms that are not followed, once per form and file. */
function noteUnfollowed(
  state: DiscoveryState,
  forms: readonly UnfollowedLoadForm[],
  path: string,
): void {
  for (const form of forms)
    state.unfollowed.set(`${form}\u0000${path}`, { form, path })
}

/** Resolves references against a base url and queues the ones that point inside the extension and are not queued yet. */
function enqueueReferences(
  state: DiscoveryState,
  references: readonly string[],
  baseUrl: URL,
  depth: number,
): void {
  for (const reference of references) {
    const relativePath = resolveExtensionReference(
      reference,
      baseUrl,
      state.extensionId,
    )
    if (relativePath === undefined || state.enqueued.has(relativePath)) continue
    state.enqueued.add(relativePath)
    state.queue.push({ relativePath, depth })
  }
}

/** Resolves a `<base href>` against the page url; Chrome ignores an invalid one, so the page url itself is the base then. */
function baseUrlOf(baseHref: string | undefined, htmlUrl: URL): URL {
  try {
    return new URL(baseHref ?? '', htmlUrl)
  } catch {
    return htmlUrl
  }
}

/** The real path of a queued file when it exists and stays inside the confinement root, else `undefined`. */
async function realFileInside(
  state: DiscoveryState,
  absolutePath: string,
): Promise<string | undefined> {
  const real = await realpath(absolutePath).catch(() => undefined)
  if (real === undefined) return undefined
  const isInside =
    real === state.confinementRoot ||
    isInsideFolder(state.confinementRoot, real)
  return isInside ? real : undefined
}

/** Seeds the queue from the surface page: its external scripts, the imports of inline modules and an import map note. */
async function seedFromPage(
  state: DiscoveryState,
  htmlPath: string,
): Promise<void> {
  const htmlRelative = relativeToRoot(state.extensionRoot, htmlPath)
  const page = findExtensionScriptReferences((await readText(htmlPath)) ?? '')
  const htmlUrl = extensionFileUrl(htmlRelative, state.extensionId)
  const baseUrl = baseUrlOf(page.baseHref, htmlUrl)
  for (const script of page.scripts) {
    if (script.kind === 'importmap')
      noteUnfollowed(state, ['import map'], htmlRelative)
    else if (script.kind === 'src')
      enqueueReferences(state, [script.src], baseUrl, 1)
    else {
      // An inline module's own imports are followed; the inline code itself is no script file.
      const inline = findExtensionImportReferences(script.code, 'module')
      noteUnfollowed(state, inline.unfollowed, htmlRelative)
      enqueueReferences(state, inline.references, baseUrl, 1)
    }
  }
}

/** Reads queued files breadth-first (a file is read at its shallowest depth) and queues what each loads, up to the depth limit. */
async function drainQueue(
  state: DiscoveryState,
  mode: ScriptLoadMode,
  workerBaseUrl: URL | undefined,
): Promise<void> {
  for (let next = state.queue.shift(); next; next = state.queue.shift()) {
    if (next.depth > EXTENSION_STATIC_LOAD_DEPTH_LIMIT) continue
    // Reachable paths are real paths, so a stop file reached through a link or a differently cased name still matches.
    const absolutePath = await realFileInside(
      state,
      join(state.extensionRoot, next.relativePath),
    )
    if (absolutePath === undefined) continue
    const source = await readText(absolutePath)
    if (source === undefined) continue
    state.reachable.add(absolutePath)
    const found = findExtensionImportReferences(source, mode)
    noteUnfollowed(state, found.unfollowed, next.relativePath)
    // importScripts urls resolve against the worker script's own location, whichever imported file calls it; module specifiers against the importing file.
    const baseUrl =
      workerBaseUrl ?? extensionFileUrl(next.relativePath, state.extensionId)
    enqueueReferences(state, found.references, baseUrl, next.depth + 1)
  }
}

/**
 * Discovers which script files an extension surface page or service worker loads statically, recursively to the depth limit (SR5, SR40, ER3).
 * Follows `<script src>`, static `import`, `export … from` and literal `importScripts(...)` (classic worker), resolving relative, root-absolute, own-id `chrome-extension://` references and a `<base href>`, and dropping query strings and fragments. Dynamic import, computed paths, `import.meta.url`, import maps and bare specifiers are not followed and are reported in `unfollowed`.
 * Called by {@link resolveChromeExtensionRun} once per context that declares a stop.
 * @param options.extensionRoot - The extension root's canonical path.
 * @param options.repositoryRoot - The repository's canonical path; a reached file whose real path leaves it is not reachable. Defaults to the extension root.
 * @param options.extensionId - The run's extension id, which decides which `chrome-extension://` urls are followed.
 * @param options.entry - The surface HTML or the worker script.
 * @returns The reachable absolute script paths and the unfollowed forms found in them.
 * @example
 * await discoverStaticLoads({ extensionRoot, extensionId, entry: { kind: 'page', htmlPath: `${extensionRoot}/popup/popup.html` } })
 * // => { reachable: Set { '<root>/popup/popup.js' }, unfollowed: [] }
 */
export async function discoverStaticLoads(options: {
  extensionRoot: string
  repositoryRoot?: string
  extensionId: string
  entry: StaticLoadEntry
}): Promise<StaticLoads> {
  const { extensionRoot, extensionId, entry } = options
  const state: DiscoveryState = {
    extensionRoot,
    confinementRoot: options.repositoryRoot ?? extensionRoot,
    extensionId,
    reachable: new Set(),
    unfollowed: new Map(),
    enqueued: new Set(),
    queue: [],
  }
  if (entry.kind === 'page') {
    await seedFromPage(state, entry.htmlPath)
    await drainQueue(state, 'module', undefined)
  } else {
    const scriptRelative = relativeToRoot(extensionRoot, entry.scriptPath)
    state.enqueued.add(scriptRelative)
    state.queue.push({ relativePath: scriptRelative, depth: 0 })
    const scriptUrl = extensionFileUrl(scriptRelative, extensionId)
    await drainQueue(
      state,
      entry.isModule ? 'module' : 'classic',
      entry.isModule ? undefined : scriptUrl,
    )
  }
  return {
    reachable: state.reachable,
    unfollowed: [...state.unfollowed.values()],
  }
}

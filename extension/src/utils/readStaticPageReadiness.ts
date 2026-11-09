import { realpath, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'

import { z } from 'zod'

import {
  STATIC_PAGE_FILE_LIMIT_BYTES,
  STATIC_PAGE_REFERENCES_MAX,
  STATIC_PAGE_SCRIPT_READS_MAX,
} from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { manifestDeclaresPackage } from './manifestDeclaresPackage'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { readStaticPageHtml } from './readStaticPageHtml'
import { readJsonInside } from './resolveNextPackage'

/** The facts a page shows before any server starts, as `codebook_status` lists them for one page. */
export type StaticPageAppReadiness = {
  /** What a start would decide on the page alone; the environment joins the shared prerequisites and a managed run. */
  ready: boolean
  /** The gaps: `no-entry-page`, `needs-bundler` (naming the first offending reference after a colon), `entry-unreadable` or `not-a-static-page`. */
  missing: string[]
  /** The entry file relative to the page folder (`index.html` for the default entry path). */
  entry: string
}

/** One plain page below the repository root as `codebook_status` lists it (`packages[]`). */
export type StaticPagePackageReadiness = StaticPageAppReadiness & {
  /** The repository-relative folder: the exact value to declare as `packageRoot`. */
  packageRoot: string
}

/** What judging a page found wrong, with what a refusal needs to word it. */
export type StaticPageProblem =
  | { gap: 'no-entry-page'; entry: string }
  | {
      gap: 'needs-bundler'
      reference: string
      kind: 'missing-file' | 'bare-import'
    }
  | { gap: 'entry-unreadable'; problem: string }
  | { gap: 'not-a-static-page'; adapter: string }

/** The adapters whose apps carry a dependency that makes a folder theirs, not a plain page's. */
const OTHER_ADAPTER_PACKAGES: ReadonlyArray<readonly [string, string]> = [
  ['react-scripts', 'react-scripts-dev'],
  ['next', 'next-dev-webpack'],
  ['vite', 'vite-dev'],
  ['expo', 'expo-web-dev'],
]

/** A package-name or scheme-bearing reference: it names something other than a file of the folder. */
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i

/** The statements of a script that import another module with a literal specifier (static form, at a statement start). */
const STATIC_IMPORT_PATTERN =
  /(?:^|[;}\n])\s*(?:import|export)\s+(?:[\w$*{},\s]*?\s*from\s*)?(['"])([^'"\n]+)\1/g

/** A dynamic `import('specifier')` with a literal specifier. */
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g

/**
 * Names the adapter whose app a folder is, from its `package.json`.
 * Called by {@link judgeStaticPage} and the discovery to keep a Next, Vite, react-scripts or Expo app out of this adapter.
 * @param manifest - The parsed `package.json`, or `undefined` for a folder without one.
 * @returns The adapter name, or `undefined` for a folder no other adapter claims.
 * @example otherAdapterOfManifest({ devDependencies: { vite: '^8' } }) // => 'vite-dev'
 */
export function otherAdapterOfManifest(manifest: unknown): string | undefined {
  return OTHER_ADAPTER_PACKAGES.find(([packageName]) =>
    manifestDeclaresPackage(manifest, packageName),
  )?.[1]
}

/**
 * Resolves the entry file of a page folder from the configured entry path.
 * Called by {@link judgeStaticPage} and the run's workspace check.
 * @param entryPath - The configured entry path (`/` when none).
 * @returns The entry file relative to the folder, forward slashes; `undefined` for a path that names no `.html` file.
 * @example staticPageEntryFile('/') // => 'index.html'
 * @example staticPageEntryFile('/demo/page.html?x=1') // => 'demo/page.html'
 */
export function staticPageEntryFile(entryPath: string): string | undefined {
  const pathname = decodeURI(entryPath.split(/[?#]/)[0] ?? '/')
  if (pathname === '/' || pathname === '') return 'index.html'
  const relative = posix.normalize(pathname.replace(/^\/+/, ''))
  if (relative.startsWith('..') || !relative.endsWith('.html')) return undefined
  return relative
}

/**
 * Tells whether a file exists in the folder as a regular file reached without a link.
 * @param folder - The page folder's real path.
 * @param relativePath - The folder-relative path.
 * @returns `true` for a readable regular file.
 * @example await fileExistsInside('/p', 'main.js') // => true
 */
async function fileExistsInside(
  folder: string,
  relativePath: string,
): Promise<boolean> {
  try {
    const real = await realpath(join(folder, relativePath))
    return isInsideFolder(folder, real) && (await stat(real)).isFile()
  } catch {
    return false
  }
}

/**
 * Finds the first bare-specifier import of a script text.
 * @param text - The script text.
 * @returns The first specifier that only a bundler resolves, or `undefined`.
 * @example firstBareImport("import { createStore } from 'redux'") // => 'redux'
 * @example firstBareImport("import x from './x.js'") // => undefined
 */
export function firstBareImport(text: string): string | undefined {
  const isBare = (specifier: string): boolean =>
    !specifier.startsWith('./') &&
    !specifier.startsWith('../') &&
    !specifier.startsWith('/') &&
    !SCHEME_PATTERN.test(specifier)
  for (const pattern of [STATIC_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN])
    for (const match of text.matchAll(pattern)) {
      const specifier = match[2]
      if (specifier !== undefined && isBare(specifier)) return specifier
    }
  return undefined
}

/**
 * Resolves a page reference to a folder-relative file path.
 * @param reference - A `src` or `href` as written.
 * @param entryFolder - The entry file's folder, folder-relative (`.` at the root).
 * @returns The folder-relative path; `undefined` for a reference that is not a file of the folder (an `https:` URL, a `data:` URL or a fragment).
 * @example resolveReference('/main.js', 'demo') // => 'main.js'
 * @example resolveReference('./a.css?v=1', 'demo') // => 'demo/a.css'
 */
function resolveReference(
  reference: string,
  entryFolder: string,
): string | undefined {
  const bare = reference.split(/[?#]/)[0] ?? ''
  if (bare === '') return undefined
  const decoded = decodeURI(bare)
  return decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(entryFolder, decoded))
}

/** What {@link findMissingReference} found: the first reference that is no file of the folder, else the same-origin script files the page names. */
type ReferenceJudgement = {
  problem?: StaticPageProblem
  scriptFiles: string[]
}

/**
 * Judges the `src` and `href` references of an entry page: each must be an absolute https (or data) URL or a file of the folder.
 * Called by {@link findBundlerProblem}.
 * @param folder - The page folder's real path.
 * @param entryFolder - The entry file's folder, folder-relative.
 * @param page - The parsed entry page.
 * @returns The first reference that names no file of the folder, else the folder-relative paths of the page's script files.
 * @example await findMissingReference('/p', '.', readStaticPageHtml('<script src="main.js"></script>')) // => { scriptFiles: ['main.js'] }
 */
async function findMissingReference(
  folder: string,
  entryFolder: string,
  page: ReturnType<typeof readStaticPageHtml>,
): Promise<ReferenceJudgement> {
  const scriptFiles: string[] = []
  for (const reference of [...page.scriptSources, ...page.linkHrefs].slice(
    0,
    STATIC_PAGE_REFERENCES_MAX,
  )) {
    // Only an absolute https URL or a data URL names something other than a file of the folder.
    if (/^https:\/\//i.test(reference) || /^data:/i.test(reference)) continue
    const resolved = resolveReference(reference, entryFolder)
    if (resolved === undefined) continue
    if (
      resolved.startsWith('..') ||
      !(await fileExistsInside(folder, resolved))
    )
      return {
        problem: { gap: 'needs-bundler', reference, kind: 'missing-file' },
        scriptFiles,
      }
    if (page.scriptSources.includes(reference)) scriptFiles.push(resolved)
  }
  return { scriptFiles }
}

/**
 * Judges the imports of the page's scripts: an inline script, or a same-origin script file (one level deep), must not import a bare specifier.
 * Called by {@link findBundlerProblem}.
 * @param folder - The page folder's real path.
 * @param inlineTexts - The texts of the page's inline scripts.
 * @param scriptFiles - The folder-relative paths of the page's script files.
 * @returns The first bare import, or `undefined`.
 * @example await findBareImportProblem('/p', ["import 'redux'"], []) // => { gap: 'needs-bundler', reference: 'redux', kind: 'bare-import' }
 */
async function findBareImportProblem(
  folder: string,
  inlineTexts: readonly string[],
  scriptFiles: readonly string[],
): Promise<StaticPageProblem | undefined> {
  const fileTexts: string[] = []
  for (const file of scriptFiles.slice(0, STATIC_PAGE_SCRIPT_READS_MAX)) {
    const text = await readRepositoryBuildText(
      folder,
      file,
      STATIC_PAGE_FILE_LIMIT_BYTES,
    ).catch(() => undefined)
    if (text !== undefined) fileTexts.push(text)
  }
  for (const text of [...inlineTexts, ...fileTexts]) {
    const specifier = firstBareImport(text)
    if (specifier !== undefined)
      return { gap: 'needs-bundler', reference: specifier, kind: 'bare-import' }
  }
  return undefined
}

/**
 * Judges the problems of the references an entry page names: a script or stylesheet that is no file of the folder, or an import only a bundler resolves.
 * Called by {@link judgeStaticPage}.
 * @param folder - The page folder's real path.
 * @param entry - The entry file, folder-relative.
 * @param html - The entry page's text.
 * @returns The first problem (missing files before imports, document order within each), or `undefined`.
 * @example await findBundlerProblem('/p', 'index.html', '<script src="/src/main.tsx"></script>') // => { gap: 'needs-bundler', reference: '/src/main.tsx', kind: 'missing-file' }
 */
async function findBundlerProblem(
  folder: string,
  entry: string,
  html: string,
): Promise<StaticPageProblem | undefined> {
  const page = readStaticPageHtml(html)
  const { problem, scriptFiles } = await findMissingReference(
    folder,
    posix.dirname(entry),
    page,
  )
  if (problem) return problem
  return findBareImportProblem(
    folder,
    page.inlineScripts.map((script) => script.text),
    scriptFiles,
  )
}

/**
 * Judges whether a folder holds a plain page Codebook can serve as written.
 *
 * Why it exists: `codebook_status` and the adapter's start must use one judgement, so the chat never starts a page status called not ready. A page that is not ready is a typed problem, never a throw. Called by {@link readStaticPageReadiness} and the adapter's workspace check.
 * @param folder - The page folder's real path.
 * @param entryPath - The configured entry path (`/` when none).
 * @returns The first problem found; `undefined` for a page that can be served.
 * @example await judgeStaticPage('/repo/examples/page', '/') // => undefined
 */
export async function judgeStaticPage(
  folder: string,
  entryPath: string,
): Promise<StaticPageProblem | undefined> {
  const manifest = await readJsonInside(folder, 'package.json', z.unknown())
  const adapter = otherAdapterOfManifest(manifest)
  if (adapter !== undefined) return { gap: 'not-a-static-page', adapter }
  const entry = staticPageEntryFile(entryPath)
  if (entry === undefined)
    return {
      gap: 'entry-unreadable',
      problem: 'the entry path names no .html file',
    }
  if (!(await fileExistsInside(folder, entry)))
    return { gap: 'no-entry-page', entry }
  let html: string
  try {
    html = await readRepositoryBuildText(
      folder,
      entry,
      STATIC_PAGE_FILE_LIMIT_BYTES,
    )
  } catch {
    return {
      gap: 'entry-unreadable',
      problem: 'the file is over the byte limit, linked or not a regular file',
    }
  }
  return findBundlerProblem(folder, entry, html)
}

/**
 * Words a problem as the `missing` entry `codebook_status` lists.
 * @param problem - What {@link judgeStaticPage} found.
 * @returns The gap name, with the first offending reference after a colon for `needs-bundler`.
 * @example staticPageMissingOf({ gap: 'needs-bundler', reference: 'redux', kind: 'bare-import' }) // => 'needs-bundler: redux'
 */
function staticPageMissingOf(problem: StaticPageProblem): string {
  return problem.gap === 'needs-bundler'
    ? `needs-bundler: ${problem.reference.slice(0, 200).replaceAll(/[\r\n]/g, ' ')}`
    : problem.gap
}

/**
 * Reads the readiness of one page folder for `codebook_status`.
 * Called by the status readiness for the root and for each discovered page.
 * @param folder - The page folder's real path.
 * @param entryPath - The entry path to judge (`/` for the listing).
 * @returns The page's readiness; a folder with no entry page reports `no-entry-page`.
 * @example await readStaticPageReadiness('/repo/examples/page') // => { ready: true, missing: [], entry: 'index.html' }
 */
export async function readStaticPageReadiness(
  folder: string,
  entryPath = '/',
): Promise<StaticPageAppReadiness> {
  const entry = staticPageEntryFile(entryPath) ?? 'index.html'
  try {
    const problem = await judgeStaticPage(folder, entryPath)
    return problem === undefined
      ? { ready: true, missing: [], entry }
      : { ready: false, missing: [staticPageMissingOf(problem)], entry }
  } catch {
    return { ready: false, missing: ['entry-unreadable'], entry }
  }
}

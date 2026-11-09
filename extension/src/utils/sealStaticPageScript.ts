import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { STATIC_PAGE_FILE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  staticPageMapLimitRefusal,
  staticPageMapUnreadableRefusal,
  staticPageNodeModulesRefusal,
  staticPageNotInScriptRefusal,
  staticPageOutsidePackageRefusal,
  staticPageSourceChangedRefusal,
  staticPageUnmappedLineRefusal,
} from '../staticPageRefusals'

import { buildIdentityScriptMap } from './buildIdentityScriptMap'
import { isInsideFolder } from './isInsideFolder'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { readStaticPageHtml } from './readStaticPageHtml'
import { staticPageEntryFile } from './readStaticPageReadiness'
import type { ResolvedPackage } from './resolveNextPackage'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'

/** What {@link sealStaticPageScript} needs to seal one stop of the page's own scripts. */
export type StaticPageSealRequest = Readonly<{
  /** The page folder the run serves. */
  page: ResolvedPackage
  /** The declared stop (repository-relative path, line and the accepted hash). */
  source: RepositoryConfiguration['source']
  /** The last line of the stop's citation. */
  citationEndLine: number
  /** The origin the static server reported. */
  ownedOrigin: string
  /** The configured entry path (`/` when none). */
  entryPath: string
  signal: AbortSignal
}>

/**
 * Reads what the static server serves at an address, as bytes.
 * Called by {@link sealStaticPageScript} to compare the served bytes with the checked-out file.
 * @param url - The address on the owned origin.
 * @param expectedText - The checked-out file's text the served bytes must equal.
 * @param signal - Ends the request when the run is cancelled.
 * @returns The body bytes of a 200 answer equal to the expected text; `undefined` for any other answer or a failed request.
 * @example await readServedBytes('http://127.0.0.1:4310/', html, signal) // => Buffer of '<!doctype html>…'
 */
async function readServedBytes(
  url: string,
  expectedText: string,
  signal: AbortSignal,
): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal })
    if (response.status !== 200) {
      await response.body?.cancel()
      return undefined
    }
    // Bytes, not text: `text()` drops a byte order mark the file keeps.
    const bytes = Buffer.from(await response.arrayBuffer())
    // Compared as bytes with the file's own bytes, so a byte order mark counts.
    return bytes.equals(Buffer.from(expectedText, 'utf8')) ? bytes : undefined
  } catch {
    return undefined
  }
}

/**
 * Seals one declared browser stop in a script of the page the static server serves, before the browser opens.
 *
 * Why it exists: the executed bytes are checked against these served bytes before the click. A page script has no source map of its own, so the seal gives it an identity map onto the file it sits in: the entry page's inline `<script>` (the stop line must lie inside one, and the served page must equal the file) or a same-origin `.js` file (the served bytes must equal the file). Called by the `static-page` adapter's `readBundle` for a stop in the page's own files.
 * @param request - The page, the stop, the owned origin and the entry path.
 * @returns The sealed bundle and the discovery measurements, as the other adapters' seals return them.
 * @throws `STATIC_PAGE_SEAL_FAILED` (`node-modules`, `outside-package`, `not-in-page-script`, `unmapped-line`, `map-limit`, `map-unreadable`), all `partial`; `SOURCE_CHANGED` when the file differs from the accepted hash or from what the server serves.
 * @example
 * const { bundle } = await sealStaticPageScript({ page, source, citationEndLine: 30, ownedOrigin: 'http://127.0.0.1:4310', entryPath: '/', signal })
 */
export async function sealStaticPageScript(
  request: StaticPageSealRequest,
): Promise<{ bundle: BundleSource; discovery: unknown }> {
  const started = performance.now()
  const { page, source } = request
  const relativePath = page.toPackageRelative(source.path)
  // A stop the mapper cannot place inside the page is refused, never read from its repository path.
  if (relativePath === undefined)
    throw staticPageOutsidePackageRefusal(
      page.packageRootRelative,
      [source.path],
      'partial',
    )
  if (relativePath.split('/').includes('node_modules'))
    throw staticPageNodeModulesRefusal([source.path], 'partial')
  const realRoot = await realpath(page.packageRoot)
  const filePath = join(realRoot, relativePath)
  const real = await realpath(filePath).catch(() => undefined)
  if (real === undefined || !isInsideFolder(realRoot, real))
    throw staticPageOutsidePackageRefusal(
      page.packageRootRelative,
      [source.path],
      'partial',
    )
  const fileText = await readRepositoryBuildText(
    realRoot,
    relativePath,
    STATIC_PAGE_FILE_LIMIT_BYTES,
    request.signal,
  ).catch(() => {
    throw staticPageMapUnreadableRefusal(
      'the stop file cannot be read within the byte limit',
    )
  })
  if (sha256(fileText) !== source.hash)
    throw staticPageSourceChangedRefusal(source.path)
  const isEntryPage = relativePath === staticPageEntryFile(request.entryPath)
  const isHtml = /\.html?$/i.test(relativePath)
  // A page other than the entry page is never loaded by the run.
  if (isHtml && !isEntryPage)
    throw staticPageNotInScriptRefusal(source.path, source.line)
  const servedPath = isHtml
    ? request.entryPath
    : `/${relativePath.split('/').map(encodeURIComponent).join('/')}`
  const servedBytes = await readServedBytes(
    `${request.ownedOrigin}${servedPath}`,
    fileText,
    request.signal,
  )
  if (servedBytes === undefined)
    throw staticPageSourceChangedRefusal(source.path)
  const script = isHtml
    ? readStaticPageHtml(fileText).inlineScripts.find(
        (candidate) =>
          source.line - 1 >= candidate.startLine &&
          source.line - 1 <= candidate.endLine,
      )
    : {
        text: fileText,
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        isModule: false,
      }
  if (script === undefined)
    throw staticPageNotInScriptRefusal(source.path, source.line)
  const sourcePath = real.replaceAll('\\', '/')
  const sourceMap = buildIdentityScriptMap({
    sourcePath,
    sourceText: fileText,
    scriptText: script.text,
    startLine: script.startLine,
    startColumn: script.startColumn,
  })
  const scan = sourceMapMappedPositions(
    JSON.parse(sourceMap).mappings,
    0,
    source.line,
    request.citationEndLine,
  )
  if (!scan.positions.length) {
    if (scan.complete)
      throw staticPageUnmappedLineRefusal(
        source.path,
        source.line,
        request.citationEndLine,
      )
    throw staticPageMapLimitRefusal('mapped-position-segments', 4_000_000)
  }
  const bundle: BundleSource = {
    sourcePath,
    mapSource: sourcePath,
    scriptUrl: `${request.ownedOrigin}${servedPath}`,
    source: fileText,
    javascript: script.text,
    sourceMap,
    chunkPath: '',
    chunkHash: sha256(script.text),
    ...(isHtml
      ? { scriptStart: { line: script.startLine, column: script.startColumn } }
      : {}),
  }
  return {
    bundle,
    discovery: {
      readBytes: servedBytes.length,
      durationMs: performance.now() - started,
      candidates: [bundle.scriptUrl],
      manifestHash: sha256(fileText),
    },
  }
}

import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REACT_SCRIPTS_LIBRARY_REPORT_LIMIT_BYTES,
  REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
} from '../constants'

import { isInsideFolder } from './isInsideFolder'

/** One emitted `.js` asset of a compilation line: its name, the SHA-256 of its bytes and the real paths of the modules of its chunks that may be copies of the library. */
export type WebpackLibraryReportAsset = {
  name: string
  sha256: string
  resources: string[]
}

/** Which compilation a line speaks of and where it writes. The react-scripts preload writes neither; the Next preload writes both (`compiler` is webpack's name: `client`, `server` or `edge-server`). */
type WebpackLibraryCompilerFields = { compiler?: string; outputPath?: string }

/** A line of the preload: it wrapped a webpack configuration factory's result (for one compiler, when the line names it) and patched it. */
type WebpackLibraryWrappedLine = {
  wrapped: true
} & WebpackLibraryCompilerFields

/** The preload could not patch the configuration (of the named compiler, when the line names one); it ran unpatched. */
type WebpackLibraryErrorLine = { error: string; compiler?: string }

/** The preload patched the configuration but failed to describe a later compilation; the patch itself is in place. */
type WebpackLibraryReportErrorLine = { reportError: string }

/** One compilation: written at webpack's `emit`, before the assets are served. */
type WebpackLibraryCompilationLine = {
  compilationHash: string
  publicPath: string
  assets: WebpackLibraryReportAsset[]
  /** Requests of external modules that name the package: Node loads them at run time, so no resource shows which copy they are. */
  externals?: string[]
} & WebpackLibraryCompilerFields

/** A compilation whose line would have exceeded the per-line bound; its scripts match nothing. `publicPath` lets the reader still tell its scripts are owned. */
type WebpackLibraryTruncatedLine = {
  compilationHash: string
  publicPath?: string
  truncated: true
} & WebpackLibraryCompilerFields

/** Every line the generated preload (see {@link buildReactScriptsLibraryPreloadSource}) can write. */
type WebpackLibraryReportLine =
  | WebpackLibraryWrappedLine
  | WebpackLibraryErrorLine
  | WebpackLibraryReportErrorLine
  | WebpackLibraryCompilationLine
  | WebpackLibraryTruncatedLine

/** A matched asset together with the public path it is served under. */
export type WebpackLibraryReportMatch = WebpackLibraryReportAsset & {
  publicPath: string
  /** The compiler that emitted the asset, when its line names one. */
  compiler?: string
  /** The folder the compiler writes to, when its line names one. */
  outputPath?: string
}

/** Why a report cannot be trusted. */
export type WebpackLibraryReportUnreadableCause =
  | 'malformed-line'
  | 'line-too-long'
  | 'report-too-large'
  | 'report-shrunk'
  | 'report-missing'
  | 'report-unreadable'

/** The verdict {@link WebpackLibraryReportReader.match} gives for one script. */
export type WebpackLibraryScriptMatch =
  | { kind: 'matched'; asset: WebpackLibraryReportMatch }
  | { kind: 'unmatched-owned' }
  | { kind: 'not-owned' }

/** The name webpack gives the compiler of Next's edge runtime. */
const EDGE_COMPILER = 'edge-server'

/**
 * Tells whether a compiler's output is served to the page: the client compiler, or one that names none (react-scripts).
 *
 * Used by the reader to keep server-side lines out of page matching and of the public-path ownership check.
 * @param compiler - The `compiler` of a report line, if any.
 * @returns True for `undefined` and `client`.
 * @example
 * isPageCompiler('client') // => true
 * isPageCompiler('server') // => false
 */
function isPageCompiler(compiler: string | undefined): boolean {
  return compiler === undefined || compiler === 'client'
}

/** The real path of a path that may not exist yet; an absent path stays as given, made absolute. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The real path of the file a `file:` URL names, or `undefined` for any other URL. */
function realFileOfUrl(url: string): string | undefined {
  try {
    return realPathOf(fileURLToPath(url))
  } catch {
    return undefined
  }
}

const NEWLINE_BYTE = 0x0a

/** Tells whether a value is a non-null object, so a parsed JSON line can be inspected by key. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tells whether a value is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Reads one asset entry of a compilation line, or `undefined` when its shape is wrong. */
function readAsset(value: unknown): WebpackLibraryReportAsset | undefined {
  if (!isRecord(value)) return undefined
  const { name, sha256, resources } = value
  if (typeof name !== 'string' || typeof sha256 !== 'string') return undefined
  if (!isStringArray(resources)) return undefined
  return { name, sha256: sha256.toLowerCase(), resources }
}

/**
 * Reads the optional `compiler` and `outputPath` of a report line.
 *
 * Used by {@link parseWebpackLibraryReportLine} for every line kind; an empty string (what the preload writes when webpack gives no name) counts as absent.
 * @param record - The parsed JSON line.
 * @returns The fields that are present, or `undefined` when one has the wrong type (the line is then malformed).
 * @example
 * readCompilerFields({ compiler: 'server', outputPath: '/x/server' }) // => { compiler: 'server', outputPath: '/x/server' }
 * readCompilerFields({ compiler: 3 }) // => undefined
 */
function readCompilerFields(
  record: Record<string, unknown>,
): WebpackLibraryCompilerFields | undefined {
  const { compiler, outputPath } = record
  if (compiler !== undefined && typeof compiler !== 'string') return undefined
  if (outputPath !== undefined && typeof outputPath !== 'string') {
    return undefined
  }
  return {
    ...(compiler ? { compiler } : {}),
    ...(outputPath ? { outputPath } : {}),
  }
}

/**
 * Parses a compilation line (complete or truncated).
 *
 * Called by {@link parseWebpackLibraryReportLine} when a line is none of the marker lines.
 * @param record - The parsed JSON line.
 * @param fields - The line's compiler fields.
 * @returns The typed line, or `undefined` when its shape is wrong.
 * @example
 * parseCompilationLine({ compilationHash: 'h', publicPath: '/', assets: [] }, {}) // => { compilationHash: 'h', publicPath: '/', assets: [] }
 */
function parseCompilationLine(
  record: Record<string, unknown>,
  fields: WebpackLibraryCompilerFields,
): WebpackLibraryReportLine | undefined {
  const { compilationHash, publicPath, assets, externals } = record
  if (typeof compilationHash !== 'string') return undefined
  if (record.truncated === true) {
    return typeof publicPath === 'string'
      ? { compilationHash, publicPath, truncated: true, ...fields }
      : { compilationHash, truncated: true, ...fields }
  }
  if (typeof publicPath !== 'string' || !Array.isArray(assets)) return undefined
  if (externals !== undefined && !isStringArray(externals)) return undefined
  const readAssets = assets.map(readAsset)
  const valid = readAssets.filter((asset) => asset !== undefined)
  if (valid.length !== readAssets.length) return undefined
  return {
    compilationHash,
    publicPath,
    assets: valid,
    ...(externals ? { externals } : {}),
    ...fields,
  }
}

/**
 * Parses one complete report line.
 *
 * Used by {@link WebpackLibraryReportReader} for every complete line; the shapes are the ones the generated preloads write.
 * @param text - The line without its newline.
 * @returns The typed line, or `undefined` when the text is not valid JSON or has no known shape.
 * @example
 * parseWebpackLibraryReportLine('{"wrapped":true}') // => { wrapped: true }
 * parseWebpackLibraryReportLine('{"wrapped":true,"compiler":"server","outputPath":"/x"}') // => { wrapped: true, compiler: 'server', outputPath: '/x' }
 * parseWebpackLibraryReportLine('{oops') // => undefined
 */
function parseWebpackLibraryReportLine(
  text: string,
): WebpackLibraryReportLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const fields = readCompilerFields(parsed)
  if (fields === undefined) return undefined
  if (parsed.wrapped === true) return { wrapped: true, ...fields }
  if (typeof parsed.error === 'string') {
    return {
      error: parsed.error,
      ...(fields.compiler ? { compiler: fields.compiler } : {}),
    }
  }
  if (typeof parsed.reportError === 'string') {
    return { reportError: parsed.reportError }
  }
  return parseCompilationLine(parsed, fields)
}

/** The path part of a script URL or public path, without query or fragment; percent escapes are kept. */
function pathOf(urlOrPath: string): string {
  try {
    return new URL(urlOrPath).pathname
  } catch {
    return urlOrPath.split(/[?#]/, 1).join('')
  }
}

/**
 * Decodes the percent escapes of a path so it can be compared with a raw asset name.
 *
 * Used by {@link WebpackLibraryReportReader.match}: `new URL(...).pathname` of `/a b.js` is `/a%20b.js`, while the report names the asset `a b.js`.
 * @param path - A path as {@link pathOf} returns it.
 * @returns The decoded path, or `undefined` when an escape is malformed (such a path matches nothing).
 * @example
 * decodePath('/static/a%20b.js') // => '/static/a b.js'
 * decodePath('/static/%E0%A4%A') // => undefined
 */
function decodePath(path: string): string | undefined {
  try {
    return decodeURI(path)
  } catch {
    return undefined
  }
}

/**
 * Tells whether a report line's public path can say which scripts the preload owns.
 *
 * An empty public path would claim every script and webpack's `'auto'` is no URL prefix, so neither may classify scripts.
 * @param publicPath - The `publicPath` of a report line.
 * @returns True when the path may be used for ownership and URL matching.
 * @example
 * isUsablePublicPath('/') // => true
 * isUsablePublicPath('auto') // => false
 */
function isUsablePublicPath(publicPath: string): boolean {
  return publicPath !== '' && publicPath !== 'auto'
}

/**
 * Reads the compilation report the generated react-scripts preload appends to, and answers which emitted asset a script the page parsed came from.
 *
 * The run creates one per report file and calls {@link WebpackLibraryReportReader.refresh} whenever it wants current facts (before judging a script, at the end of the run). Bytes are read from where the last call stopped, so rebuilds append lines the reader keeps in an index by SHA-256. Classification of resources (packed copy or another copy) is not done here.
 * @example
 * const reader = new WebpackLibraryReportReader()
 * reader.refresh('/p/report.jsonl')
 * reader.match('http://localhost:3000/static/js/bundle.js', hashOfScript) // => { kind: 'matched', asset }
 */
export class WebpackLibraryReportReader {
  private offset = 0
  private pending = Buffer.alloc(0)
  private readonly index = new Map<string, WebpackLibraryReportMatch[]>()
  private readonly publicPaths = new Set<string>()
  private wrappedSeen = false
  private errorMessage: string | undefined
  private reportErrorMessage: string | undefined
  private unreadable: WebpackLibraryReportUnreadableCause | undefined
  private truncatedCount = 0
  private compilationCount = 0
  private readonly wrappedCompilerNames = new Set<string>()
  private readonly erroredCompilerNames = new Set<string>()
  private readonly compiledCompilerNames = new Set<string>()
  private readonly serverOutputPaths = new Set<string>()
  /** Real paths of announced server output folders, kept once resolved; a folder that cannot be resolved yet is looked up again. */
  private readonly realServerOutputPaths = new Map<string, string>()
  private serverOutputUnknownCompiler: string | undefined
  private readonly externalRequests = new Set<string>()
  private readonly edgeAssets: WebpackLibraryReportMatch[] = []

  /**
   * @param wholeLimitBytes - The most bytes of the report that are read.
   * @param lineLimitBytes - The most bytes of one line.
   */
  constructor(
    private readonly wholeLimitBytes = REACT_SCRIPTS_LIBRARY_REPORT_LIMIT_BYTES,
    private readonly lineLimitBytes = REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
  ) {}

  /** Whether the preload wrapped the configuration factory. */
  get wrapped(): boolean {
    return this.wrappedSeen
  }

  /** The message of the first `error` line, or `undefined`. */
  get errorCause(): string | undefined {
    return this.errorMessage
  }

  /** The message of the first `reportError` line (a later compilation could not be described), or `undefined`; unlike {@link errorCause} it does not mean the patch was not applied. */
  get reportErrorCause(): string | undefined {
    return this.reportErrorMessage
  }

  /** The first server-side compiler (not `client`) whose `wrapped` line carried no output folder, or `undefined`; its server scripts cannot be told apart from foreign ones, so the observation cannot be claimed. */
  get serverOutputUnknownCause(): string | undefined {
    return this.serverOutputUnknownCompiler
  }

  /** Why the report cannot be trusted, or `undefined` while it reads cleanly. */
  get unreadableCause(): WebpackLibraryReportUnreadableCause | undefined {
    return this.unreadable
  }

  /** How many compilations were written as `truncated`. */
  get truncatedCompilations(): number {
    return this.truncatedCount
  }

  /** How many compilation lines (complete or truncated) were read, whatever their public path. */
  get compilationsRead(): number {
    return this.compilationCount
  }

  /** Whether a compilation line gave a public path that can classify scripts (see {@link isUsablePublicPath}). */
  get hasUsablePublicPath(): boolean {
    return this.publicPaths.size > 0
  }

  /**
   * Tells whether a script the page parsed would be a bundle script the reader cannot classify yet, because no usable public path is known.
   *
   * Called by the react-scripts library route when {@link match} says `not-owned`: without any usable public path every `.js` script reads `not-owned`, which is missing evidence and no proof that the script is foreign. An inline script (reported with the document URL, no `.js` path) is never a bundle script.
   * @param url - The script URL.
   * @returns True when the URL path ends in `.js` and no usable public path is known.
   * @example
   * reader.isUnclassifiedBundleScript('http://localhost:3000/static/js/bundle.js') // => true while the report has no usable public path
   */
  isUnclassifiedBundleScript(url: string): boolean {
    if (this.hasUsablePublicPath) return false
    const rawPath = pathOf(url)
    return (decodePath(rawPath) ?? rawPath).endsWith('.js')
  }

  /** The bytes of a trailing line that has no newline yet. */
  get pendingBytes(): number {
    return this.pending.length
  }

  /**
   * Reads what was appended to the report file since the last call.
   *
   * Called by the react-scripts library route before it judges a script and at the end of the run; it never throws and marks the report unreadable instead.
   * @param reportPath - The report file.
   * @param isRequired - When true, a missing file is `unreadable` (`report-missing`); otherwise it just has no lines yet.
   * @returns Nothing; the facts are read through the getters and {@link match}.
   * @example
   * reader.refresh('/p/report.jsonl', true)
   * reader.wrapped // => true once the preload wrapped the factory
   */
  refresh(reportPath: string, isRequired = false): void {
    if (this.unreadable !== undefined) return
    let size: number
    try {
      size = statSync(reportPath).size
    } catch (error) {
      const isMissing =
        error instanceof Error && 'code' in error && error.code === 'ENOENT'
      if (isMissing) {
        if (isRequired) this.unreadable = 'report-missing'
      } else this.unreadable = 'report-unreadable'
      return
    }
    if (size > this.wholeLimitBytes) {
      this.unreadable = 'report-too-large'
      return
    }
    if (size < this.offset) {
      this.unreadable = 'report-shrunk'
      return
    }
    if (size === this.offset) return
    const chunk = this.readRange(reportPath, size - this.offset)
    if (chunk) this.append(chunk)
  }

  /**
   * Reads `length` bytes from the current offset.
   *
   * Runs inside {@link refresh} when the file grew; a read failure marks the report `report-unreadable`.
   * @param reportPath - The report file.
   * @param length - How many bytes were appended since the last read.
   * @returns The bytes read, or `undefined` after a failure.
   * @example
   * const chunk = this.readRange('/p/report.jsonl', 120)
   */
  private readRange(reportPath: string, length: number): Buffer | undefined {
    const buffer = Buffer.alloc(length)
    let descriptor: number | undefined
    try {
      descriptor = openSync(reportPath, 'r')
      let filled = 0
      while (filled < length) {
        const count = readSync(
          descriptor,
          buffer,
          filled,
          length - filled,
          this.offset + filled,
        )
        if (count === 0) break
        filled += count
      }
      return buffer.subarray(0, filled)
    } catch {
      this.unreadable = 'report-unreadable'
      return undefined
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }

  /**
   * Feeds appended bytes: complete lines are parsed, a trailing line without a newline stays pending.
   *
   * Called by {@link refresh} with the bytes it read, and directly by tests.
   * @param chunk - The bytes appended to the report.
   * @returns Nothing; lines are recorded and the pending tail is kept.
   * @example
   * reader.append(Buffer.from('{"wrapped":true}\n'))
   * reader.wrapped // => true
   */
  append(chunk: Buffer): void {
    this.offset += chunk.length
    let rest = Buffer.concat([this.pending, chunk])
    for (
      let newline = rest.indexOf(NEWLINE_BYTE);
      newline !== -1;
      newline = rest.indexOf(NEWLINE_BYTE)
    ) {
      this.acceptLine(rest.subarray(0, newline))
      rest = rest.subarray(newline + 1)
    }
    if (rest.length > this.lineLimitBytes) this.markUnreadable('line-too-long')
    this.pending = Buffer.from(rest)
  }

  /**
   * Records why the report cannot be trusted; the first cause wins.
   *
   * Called by {@link acceptLine} and {@link append} when a line is too long or malformed.
   * @param cause - The reason to record.
   * @example
   * this.markUnreadable('malformed-line')
   */
  private markUnreadable(cause: WebpackLibraryReportUnreadableCause): void {
    this.unreadable ??= cause
  }

  /**
   * Checks the size of one complete line, parses it and records it.
   *
   * Called by {@link append} for every line up to a newline; blank lines are skipped.
   * @param bytes - The line without its newline.
   * @example
   * this.acceptLine(Buffer.from('{"wrapped":true}'))
   */
  private acceptLine(bytes: Buffer): void {
    if (bytes.length > this.lineLimitBytes) {
      this.markUnreadable('line-too-long')
      return
    }
    const text = bytes.toString('utf8')
    if (text.trim() === '') return
    const line = parseWebpackLibraryReportLine(text)
    if (line === undefined) {
      this.markUnreadable('malformed-line')
      return
    }
    this.record(line)
  }

  /**
   * Applies one parsed line to the reader's facts.
   *
   * Called by {@link acceptLine}; public paths that are empty or `'auto'` are not remembered, so they never make a script owned.
   * @param line - The typed line.
   * @example
   * this.record({ wrapped: true })
   */
  private record(line: WebpackLibraryReportLine): void {
    if ('wrapped' in line) {
      this.wrappedSeen = true
      this.recordWrappedCompiler(line)
    } else if ('error' in line) {
      this.errorMessage ??= line.error
      if (line.compiler !== undefined)
        this.erroredCompilerNames.add(line.compiler)
    } else if ('reportError' in line) {
      this.reportErrorMessage ??= line.reportError
    } else {
      this.recordCompilation(line)
    }
  }

  /**
   * Remembers which compiler a `wrapped` line announced and where a server-side one writes.
   *
   * Called by {@link record}; a server-side compiler with no output folder is remembered as a fault, because its scripts could never be owned.
   * @param line - The `wrapped` line.
   * @example
   * this.recordWrappedCompiler({ wrapped: true, compiler: 'server', outputPath: '/o/server' })
   */
  private recordWrappedCompiler(
    line: Extract<WebpackLibraryReportLine, { wrapped: true }>,
  ): void {
    if (line.compiler === undefined) return
    this.wrappedCompilerNames.add(line.compiler)
    if (isPageCompiler(line.compiler)) return
    if (line.outputPath === undefined) {
      // A server-side compiler without an output folder: its scripts could never be owned
      this.serverOutputUnknownCompiler ??= line.compiler
    } else this.serverOutputPaths.add(line.outputPath)
  }

  /**
   * Applies a compilation line (complete or truncated) to the reader's facts.
   *
   * Called by {@link record}; a public path counts for the owned-script check only on a line of a page compiler (the client, or one that names no compiler), because a server compilation's public path says nothing about which page scripts are the preload's.
   * @param line - The compilation line.
   * @example
   * this.recordCompilation({ compilationHash: 'h', publicPath: '/_next/', compiler: 'client', assets: [] })
   */
  private recordCompilation(
    line: WebpackLibraryCompilationLine | WebpackLibraryTruncatedLine,
  ): void {
    this.compilationCount += 1
    if (line.compiler !== undefined)
      this.compiledCompilerNames.add(line.compiler)
    if (line.publicPath !== undefined && isPageCompiler(line.compiler)) {
      this.rememberPublicPath(line.publicPath)
    }
    if ('truncated' in line) {
      this.truncatedCount += 1
      return
    }
    for (const request of line.externals ?? [])
      this.externalRequests.add(request)
    for (const asset of line.assets) this.addToIndex(line, asset)
  }

  /** Remembers a public path for the owned-script check unless it is unusable (see {@link isUsablePublicPath}). */
  private rememberPublicPath(publicPath: string): void {
    if (isUsablePublicPath(publicPath)) this.publicPaths.add(publicPath)
  }

  /**
   * Adds an asset to the index; a repeated name of the same compiler under the same public path (a rebuild) replaces the older entry of the same hash.
   *
   * Called by {@link recordCompilation} for every asset of a compilation line. An asset of the edge compiler that holds a library resource is also kept for {@link edgeLibraryAssets}.
   * @param line - The compilation line.
   * @param asset - The emitted asset.
   * @example
   * this.addToIndex({ compilationHash: 'h', publicPath: '/', assets: [] }, { name: 'static/js/bundle.js', sha256: 'ab…', resources: [] })
   */
  private addToIndex(
    line: WebpackLibraryCompilationLine,
    asset: WebpackLibraryReportAsset,
  ): void {
    const entries = this.index.get(asset.sha256) ?? []
    const kept = entries.filter(
      (entry) =>
        entry.name !== asset.name ||
        entry.publicPath !== line.publicPath ||
        entry.compiler !== line.compiler,
    )
    const entry: WebpackLibraryReportMatch = {
      ...asset,
      publicPath: line.publicPath,
      ...(line.compiler ? { compiler: line.compiler } : {}),
      ...(line.outputPath ? { outputPath: line.outputPath } : {}),
    }
    kept.push(entry)
    this.index.set(asset.sha256, kept)
    if (line.compiler === EDGE_COMPILER && asset.resources.length > 0) {
      this.edgeAssets.push(entry)
    }
  }

  /**
   * Judges one script the page parsed.
   *
   * A script matches only when its URL path equals an asset's `publicPath + name` and the asset's SHA-256 equals the script's hash; there is no fallback by name. Only the assets of page compilers (the client, or a compiler that names none) can match. A script under a known public path whose path ends in `.js` and that matches nothing (including every script of a truncated compilation, and any script given no hash) is `unmatched-owned`.
   * @param url - The script URL (query and fragment are ignored).
   * @param hash - The SHA-256 the debugger reports for the script, or `undefined` when it reported none.
   * @example
   * reader.matchPage('http://localhost:3000/static/js/bundle.js?x=1', 'ab12…') // => { kind: 'matched', asset: { … } }
   */
  matchPage(url: string, hash: string | undefined): WebpackLibraryScriptMatch {
    const rawPath = pathOf(url)
    // A malformed escape decodes to nothing: it can still be owned but never matches an asset.
    const urlPath = decodePath(rawPath)
    if (hash && urlPath !== undefined) {
      const candidates = this.index.get(hash.toLowerCase()) ?? []
      const found = candidates.find(
        (entry) =>
          isPageCompiler(entry.compiler) &&
          (decodePath(pathOf(entry.publicPath)) ?? '\0') + entry.name ===
            urlPath,
      )
      if (found) return { kind: 'matched', asset: found }
    }
    // The preload reports only `.js` assets: an inline script (reported with the document URL) is none of its business.
    if (!(urlPath ?? rawPath).endsWith('.js')) return { kind: 'not-owned' }
    for (const publicPath of this.publicPaths) {
      const prefix = decodePath(pathOf(publicPath))
      if (prefix !== undefined && (urlPath ?? rawPath).startsWith(prefix)) {
        return { kind: 'unmatched-owned' }
      }
    }
    return { kind: 'not-owned' }
  }

  /**
   * Judges one script the page parsed, under the react-scripts route's name; the same as {@link matchPage}.
   *
   * Called by the react-scripts library route, whose report names no compiler.
   * @param url - The script URL (query and fragment are ignored).
   * @param hash - The SHA-256 the debugger reports for the script, or `undefined`.
   * @example
   * reader.match('http://localhost:3000/static/js/bundle.js', 'ab12…') // => { kind: 'matched', asset: { … } }
   */
  match(url: string, hash: string | undefined): WebpackLibraryScriptMatch {
    return this.matchPage(url, hash)
  }

  /**
   * Judges one script the server inspector parsed.
   *
   * The script is owned when its URL is a `file:` URL whose real path lies inside the `outputPath` of a server-side compiler (any compiler but the client) that a `wrapped` line announced; other server scripts (Node's own, `next/dist`) are `not-owned`. An owned script matches when its real path equals the real `outputPath` of a server-side asset joined with the asset's name and the asset's SHA-256 equals the script's hash. The script's debugger `scriptId` is deliberately no input: ids repeat across the page and server sessions.
   * @param url - The `file:` URL the debugger reports.
   * @param hash - The SHA-256 the debugger reports for the script, or `undefined`.
   * @example
   * reader.matchServer('file:///app/.next/dev/server/app/page.js', 'ab12…') // => { kind: 'matched', asset: { … } }
   * reader.matchServer('node:internal/main', undefined) // => { kind: 'not-owned' }
   */
  matchServer(
    url: string,
    hash: string | undefined,
  ): WebpackLibraryScriptMatch {
    const file = realFileOfUrl(url)
    if (file === undefined) return { kind: 'not-owned' }
    const isOwned = Array.from(this.serverOutputPaths).some((outputPath) =>
      isInsideFolder(this.realServerOutputPath(outputPath), file),
    )
    if (!isOwned) return { kind: 'not-owned' }
    const candidates = hash ? (this.index.get(hash.toLowerCase()) ?? []) : []
    const found = candidates.find(
      (entry) =>
        !isPageCompiler(entry.compiler) &&
        entry.outputPath !== undefined &&
        resolve(this.realServerOutputPath(entry.outputPath), entry.name) ===
          file,
    )
    return found
      ? { kind: 'matched', asset: found }
      : { kind: 'unmatched-owned' }
  }

  /**
   * The real path of an announced server output folder, resolved once.
   *
   * Called by {@link WebpackLibraryReportReader.matchServer} for each server script (the Next server announces about 1,700 per page). A folder that does not exist yet (the `wrapped` line precedes the first emit) is not cached, so it is resolved again on the next call.
   * @param outputPath - The folder as the preload wrote it.
   * @returns The real path, or the absolute path while the folder is absent.
   */
  private realServerOutputPath(outputPath: string): string {
    const cached = this.realServerOutputPaths.get(outputPath)
    if (cached !== undefined) return cached
    try {
      const real = realpathSync(outputPath)
      this.realServerOutputPaths.set(outputPath, real)
      return real
    } catch {
      // Not there yet: do not cache a path that will change
      return resolve(outputPath)
    }
  }

  /** The compilers a `wrapped` line named; the Next preload writes one per compiler (`client`, `server`, `edge-server`) when it builds the compiler's configuration. */
  wrappedCompilers(): ReadonlySet<string> {
    return this.wrappedCompilerNames
  }

  /** The compilers an `error` line named (their patch was not applied). */
  erroredCompilers(): ReadonlySet<string> {
    return this.erroredCompilerNames
  }

  /** The compilers a compilation line (complete or truncated) named; a server script of a compiler missing here was parsed without a report. */
  compiledCompilers(): ReadonlySet<string> {
    return this.compiledCompilerNames
  }

  /** The requests of external modules that name the package, over all compilations, sorted; any means Node loads some of the package from outside the report's sight. */
  externalsOf(): readonly string[] {
    return Array.from(this.externalRequests).sort()
  }

  /** The assets of the edge compiler that hold a library resource; the edge runtime is not observed, so any makes the observation unreadable. */
  edgeLibraryAssets(): readonly WebpackLibraryReportMatch[] {
    return this.edgeAssets
  }
}

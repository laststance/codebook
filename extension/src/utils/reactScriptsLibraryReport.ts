import { closeSync, openSync, readSync, statSync } from 'node:fs'

import {
  REACT_SCRIPTS_LIBRARY_REPORT_LIMIT_BYTES,
  REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
} from '../constants'

/** One emitted `.js` asset of a compilation line: its name, the SHA-256 of its bytes and the real paths of the modules of its chunks that may be copies of the library. */
export type ReactScriptsReportAsset = {
  name: string
  sha256: string
  resources: string[]
}

/** The first line of a report: the preload wrapped the react-scripts webpack configuration factory and patched it. */
type ReactScriptsWrappedLine = { wrapped: true }

/** The preload could not patch the configuration; it ran unpatched. */
type ReactScriptsErrorLine = { error: string }

/** The preload patched the configuration but failed to describe a later compilation; the patch itself is in place. */
type ReactScriptsReportErrorLine = { reportError: string }

/** One compilation: written at webpack's `emit`, before the assets are served. */
type ReactScriptsCompilationLine = {
  compilationHash: string
  publicPath: string
  assets: ReactScriptsReportAsset[]
}

/** A compilation whose line would have exceeded the per-line bound; its scripts match nothing. `publicPath` lets the reader still tell its scripts are owned. */
type ReactScriptsTruncatedLine = {
  compilationHash: string
  publicPath?: string
  truncated: true
}

/** Every line the generated preload (see {@link buildReactScriptsLibraryPreloadSource}) can write. */
type ReactScriptsReportLine =
  | ReactScriptsWrappedLine
  | ReactScriptsErrorLine
  | ReactScriptsReportErrorLine
  | ReactScriptsCompilationLine
  | ReactScriptsTruncatedLine

/** A matched asset together with the public path it is served under. */
export type ReactScriptsReportMatch = ReactScriptsReportAsset & {
  publicPath: string
}

/** Why a report cannot be trusted. */
export type ReactScriptsReportUnreadableCause =
  | 'malformed-line'
  | 'line-too-long'
  | 'report-too-large'
  | 'report-shrunk'
  | 'report-missing'
  | 'report-unreadable'

/** The verdict {@link ReactScriptsReportReader.match} gives for one script. */
export type ReactScriptsScriptMatch =
  | { kind: 'matched'; asset: ReactScriptsReportMatch }
  | { kind: 'unmatched-owned' }
  | { kind: 'not-owned' }

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
function readAsset(value: unknown): ReactScriptsReportAsset | undefined {
  if (!isRecord(value)) return undefined
  const { name, sha256, resources } = value
  if (typeof name !== 'string' || typeof sha256 !== 'string') return undefined
  if (!isStringArray(resources)) return undefined
  return { name, sha256: sha256.toLowerCase(), resources }
}

/**
 * Parses one complete report line.
 *
 * Used by {@link ReactScriptsReportReader} for every complete line; the shapes are the ones the generated preload writes.
 * @param text - The line without its newline.
 * @returns The typed line, or `undefined` when the text is not valid JSON or has no known shape.
 * @example
 * parseReactScriptsReportLine('{"wrapped":true}') // => { wrapped: true }
 * parseReactScriptsReportLine('{oops') // => undefined
 */
function parseReactScriptsReportLine(
  text: string,
): ReactScriptsReportLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (parsed.wrapped === true) return { wrapped: true }
  if (typeof parsed.error === 'string') return { error: parsed.error }
  if (typeof parsed.reportError === 'string') {
    return { reportError: parsed.reportError }
  }
  const { compilationHash, publicPath, assets } = parsed
  if (typeof compilationHash !== 'string') return undefined
  if (parsed.truncated === true) {
    return typeof publicPath === 'string'
      ? { compilationHash, publicPath, truncated: true }
      : { compilationHash, truncated: true }
  }
  if (typeof publicPath !== 'string' || !Array.isArray(assets)) return undefined
  const readAssets = assets.map(readAsset)
  const valid = readAssets.filter((asset) => asset !== undefined)
  if (valid.length !== readAssets.length) return undefined
  return { compilationHash, publicPath, assets: valid }
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
 * Used by {@link ReactScriptsReportReader.match}: `new URL(...).pathname` of `/a b.js` is `/a%20b.js`, while the report names the asset `a b.js`.
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
 * The run creates one per report file and calls {@link ReactScriptsReportReader.refresh} whenever it wants current facts (before judging a script, at the end of the run). Bytes are read from where the last call stopped, so rebuilds append lines the reader keeps in an index by SHA-256. Classification of resources (packed copy or another copy) is not done here.
 * @example
 * const reader = new ReactScriptsReportReader()
 * reader.refresh('/p/report.jsonl')
 * reader.match('http://localhost:3000/static/js/bundle.js', hashOfScript) // => { kind: 'matched', asset }
 */
export class ReactScriptsReportReader {
  private offset = 0
  private pending = Buffer.alloc(0)
  private readonly index = new Map<string, ReactScriptsReportMatch[]>()
  private readonly publicPaths = new Set<string>()
  private wrappedSeen = false
  private errorMessage: string | undefined
  private reportErrorMessage: string | undefined
  private unreadable: ReactScriptsReportUnreadableCause | undefined
  private truncatedCount = 0
  private compilationCount = 0

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

  /** Why the report cannot be trusted, or `undefined` while it reads cleanly. */
  get unreadableCause(): ReactScriptsReportUnreadableCause | undefined {
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
  private markUnreadable(cause: ReactScriptsReportUnreadableCause): void {
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
    const line = parseReactScriptsReportLine(text)
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
  private record(line: ReactScriptsReportLine): void {
    if ('wrapped' in line) {
      this.wrappedSeen = true
    } else if ('error' in line) {
      this.errorMessage ??= line.error
    } else if ('reportError' in line) {
      this.reportErrorMessage ??= line.reportError
    } else if ('truncated' in line) {
      this.compilationCount += 1
      this.truncatedCount += 1
      if (line.publicPath !== undefined)
        this.rememberPublicPath(line.publicPath)
    } else {
      this.compilationCount += 1
      this.rememberPublicPath(line.publicPath)
      for (const asset of line.assets) this.addToIndex(line.publicPath, asset)
    }
  }

  /** Remembers a public path for the owned-script check unless it is unusable (see {@link isUsablePublicPath}). */
  private rememberPublicPath(publicPath: string): void {
    if (isUsablePublicPath(publicPath)) this.publicPaths.add(publicPath)
  }

  /**
   * Adds an asset to the index; a repeated name under the same public path (a rebuild) replaces the older entry of the same hash.
   *
   * Called by {@link record} for every asset of a compilation line.
   * @param publicPath - The public path of the compilation.
   * @param asset - The emitted asset.
   * @example
   * this.addToIndex('/', { name: 'static/js/bundle.js', sha256: 'ab…', resources: [] })
   */
  private addToIndex(publicPath: string, asset: ReactScriptsReportAsset): void {
    const entries = this.index.get(asset.sha256) ?? []
    const kept = entries.filter(
      (entry) => entry.name !== asset.name || entry.publicPath !== publicPath,
    )
    kept.push({ ...asset, publicPath })
    this.index.set(asset.sha256, kept)
  }

  /**
   * Judges one script the page parsed.
   *
   * A script matches only when its URL path equals an asset's `publicPath + name` and the asset's SHA-256 equals the script's hash; there is no fallback by name. A script under a known public path whose path ends in `.js` and that matches nothing (including every script of a truncated compilation, and any script given no hash) is `unmatched-owned`.
   * @param url - The script URL (query and fragment are ignored).
   * @param hash - The SHA-256 the debugger reports for the script, or `undefined` when it reported none.
   * @example
   * reader.match('http://localhost:3000/static/js/bundle.js?x=1', 'ab12…') // => { kind: 'matched', asset: { … } }
   */
  match(url: string, hash: string | undefined): ReactScriptsScriptMatch {
    const rawPath = pathOf(url)
    // A malformed escape decodes to nothing: it can still be owned but never matches an asset.
    const urlPath = decodePath(rawPath)
    if (hash && urlPath !== undefined) {
      const candidates = this.index.get(hash.toLowerCase()) ?? []
      const found = candidates.find(
        (entry) =>
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
}

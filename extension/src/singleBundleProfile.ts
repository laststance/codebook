import type { StudyError } from './errors'
import type { SourceMapLimitName, SourceMapLimits } from './sourceMapLimits'

/**
 * The refusals an adapter words for the shared single-bundle read and seal.
 *
 * Why it exists: react-scripts and Expo web both seal a stop from one served bundle and its map, and differ only in what a refusal says (its code, server name and fix line). The shared module throws these and never builds its own. Read by {@link readSingleServedBundle} and {@link sealSingleBundleStop}.
 */
export type SingleBundleRefusals = Readonly<{
  /** The stop path leaves the app folder (`..`), after the server started. */
  outsidePackage: (packageRootRelative: string, files: string[]) => StudyError
  /** The map names the stop file more than once. */
  ambiguousSource: (file: string) => StudyError
  /** The stop file lies in `node_modules`. */
  nodeModules: (files: string[]) => StudyError
  /** No mapped position lies on the stop's line or within its citation. */
  unmappedLine: (
    file: string,
    line: number,
    citationEndLine: number,
  ) => StudyError
  /** A reading limit was reached; `limit` names it and `limitValue` is the profile's value of it. */
  mapLimit: (limit: SourceMapLimitName, limitValue: number) => StudyError
  /** The served bundle or map is not in a form the module reads. */
  mapUnreadable: (problem: string) => StudyError
  /** The checked-out stop file is not the text the server compiled (`SOURCE_CHANGED`, naming the server). */
  sourceChanged: (path: string) => StudyError
  /** The map does not name the stop file at all (react-scripts: its outside-package refusal; Expo: `not-in-entry-bundle`). */
  notInEntryBundle: (packageRootRelative: string, files: string[]) => StudyError
}>

/**
 * What differs between adapters that serve one development bundle: refusal wording, size limits, which entry-page script is the bundle and where its map is.
 *
 * Why it exists: the discovery, read, cache and seal are one module ({@link sealSingleBundleStop}) used by react-scripts and Expo web; an adapter passes its profile instead of copying the code. Built once per adapter ({@link REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE}).
 */
export type SingleBundleProfile = Readonly<{
  refusals: SingleBundleRefusals
  /** The limits of every read of the bundle and map; the adapter passes the same object to the verifier through the sealed bundle's `limits`. */
  limits: SourceMapLimits
  /**
   * Picks the development bundle from the entry page's `<script src>` addresses on the owned origin.
   * Called by {@link findSingleBundleUrl} with a lazy iterable, in document order: a selector that stops early never resolves later tags.
   * @param scripts - Each script address on the owned origin, resolved against the entry page.
   * @returns The bundle's address, or `undefined` when the page names none (yet) or names it ambiguously.
   */
  selectBundleScript: (scripts: Iterable<URL>) => URL | undefined
  /**
   * Opts in to quoting the server's error body: a non-success answer keeps the start of its body for the adapter to quote (Expo quotes Metro's message). Left out, a non-success body is cancelled unread, so a stalled body never holds a readiness poll.
   */
  quoteErrorBody?: boolean
  /**
   * Opts in to refusing an entry page that does not name exactly one bundle, instead of polling for one.
   * `count` counts the web bundles among the page's scripts; `refusal` words the refusal for a page that names a count other than one. Absent (react-scripts), such a page is "not ready yet".
   */
  unclearEntryPage?: {
    count: (scripts: Iterable<URL>) => number
    refusal: (count: number) => StudyError
  }
  /**
   * Names the `Host` the reads of the entry page, bundle and map present, while the connection stays on the owned origin.
   * Absent (react-scripts), the plain address is requested with the global `fetch`. Expo's Metro writes the request's host into the bundle's last line, so it presents the browser's host and the sealed bytes equal the executed bytes.
   * @param ownedOrigin - The owned origin (`http://127.0.0.1:<port>`).
   * @returns The `Host` header value (`localhost:<port>`).
   */
  requestHostOf?: (ownedOrigin: string) => string
  /**
   * Finds the address of the bundle's source map from the `sourceMappingURL` comment the bundle ends with.
   * @param reference - The comment's value, absolute or relative.
   * @param bundleUrl - The address the bundle was read at.
   * @param ownedOrigin - The owned origin (`http://127.0.0.1:<port>`); only this origin is fetched.
   * @returns The map's address on the owned origin, or `undefined` for a map elsewhere (refused as unreadable). An adapter whose server writes another host name for the same port (Metro writes `localhost`) returns the owned origin's address.
   */
  resolveMapUrl: (
    reference: string,
    bundleUrl: string,
    ownedOrigin: string,
  ) => URL | undefined
}>

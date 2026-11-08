import { REACT_SCRIPTS_LIBRARY_REPORT_SETTLE_MS } from './constants'
import type {
  LibraryAttribution,
  LibraryAttributionScope,
  LibraryScript,
  LibraryScriptAttribution,
  LibraryScriptVerdict,
} from './libraryRoute'
import { isInsideFolder } from './utils/isInsideFolder'
import { WebpackLibraryReportReader } from './utils/webpackLibraryReport'

/** How often the run looks again at a report whose last line is still being written. */
const REPORT_SETTLE_POLL_MS = 50

/** Builds the attribution of one script from its verdicts; its `pageObserved` is fixed by the participant that announced it. */
type ObservedBuilder = (
  verdict: LibraryScriptVerdict,
  additionalVerdicts?: readonly LibraryScriptVerdict[],
) => LibraryScriptAttribution

/** Tells whether a script URL belongs to the run's own origin; a URL that does not parse belongs to nobody. */
function isOwnedScriptUrl(script: LibraryScript): boolean {
  try {
    return script.isOwnedOrigin(new URL(script.url).origin)
  } catch {
    return false
  }
}

/**
 * The webpack half of the library route: matches a script a debugger parsed to an asset of the preload's compilation report and judges the files of that asset.
 *
 * Why it exists: a webpack build serves bundles whose modules cannot be traced by URL; the preload writes, at each compilation's `emit`, which library-looking files each emitted asset holds, and the SHA-256 of its bytes equals the debugger's `hash` of the script (Cycle 0097 E1 (g)). Created by {@link WebpackLibraryRoute}; {@link LibraryRoute.observeScript} calls it for each parsed script.
 * A script whose line may still be unterminated is deferred and judged again once the run has read the rest of the report (see {@link WebpackReportAttribution.takeDeferred}).
 */
export class WebpackReportAttribution implements LibraryAttribution {
  /** Reads the report incrementally; the run asks it for the applied marker too. */
  readonly reader = new WebpackLibraryReportReader()
  /** The ids of the scripts already judged, so a script announced twice counts once. */
  private readonly judgedScriptIds = new Set<string>()
  /** The scripts that matched nothing while the report ended in a line not yet terminated. */
  private deferred: LibraryScript[] = []
  private isFinal = false
  /** How many owned `.js` scripts were judged `not-owned` while no usable public path was known: missing evidence, not a verdict. */
  private unclassifiedScriptCount = 0

  /**
   * @param reportPathOf - The report file once the private folder is fixed.
   * @param observesServer - Whether this is a Next-style run whose server scripts are matched too and whose report must show every compiler wrapped (see {@link WebpackReportAttribution.reportFaultCause}).
   */
  constructor(
    private readonly reportPathOf: () => string | undefined,
    private readonly observesServer = false,
  ) {}

  /**
   * Faults of the whole report that make an observation unclaimable, for a run that observes the server.
   *
   * Called by {@link WebpackLibraryRoute.finalize} after the deferred scripts were judged. A react-scripts run has none of these lines, so it returns `undefined` there.
   * @returns The first cause, in this order: `redirect-not-applied` (an `error` line, or a compilation of a compiler no `wrapped` line announced), `report-error: <message>` (a later compilation could not be described), `server-output-unknown: <compiler>` (a server-side compiler announced no output folder, so its scripts cannot be owned), `library-externalized: <request>` (Node loads some of the package from outside the report's sight, D23), `edge-unobserved` (the edge compiler holds a library resource, D24); `undefined` when none.
   * @example attribution.reportFaultCause() // => 'edge-unobserved'
   */
  reportFaultCause(): string | undefined {
    if (!this.observesServer) return undefined
    const { reader } = this
    const wrapped = reader.wrappedCompilers()
    const hasUnwrappedCompiler = Array.from(reader.compiledCompilers()).some(
      (compiler) => !wrapped.has(compiler),
    )
    if (reader.errorCause !== undefined || hasUnwrappedCompiler)
      return 'redirect-not-applied'
    if (reader.reportErrorCause !== undefined)
      return `report-error: ${reader.reportErrorCause}`
    const { serverOutputUnknownCause } = reader
    if (serverOutputUnknownCause !== undefined)
      return `server-output-unknown: ${serverOutputUnknownCause}`
    const [external] = reader.externalsOf()
    if (external !== undefined) return `library-externalized: ${external}`
    return reader.edgeLibraryAssets().length > 0 ? 'edge-unobserved' : undefined
  }

  /** The identity of a script: ids repeat across the page and server sessions, so the participant is part of it. */
  private identityOf(script: LibraryScript): string | undefined {
    return script.scriptId === undefined
      ? undefined
      : `${script.participant ?? 'browser'}:${script.scriptId}`
  }

  /** Builds the attribution of a script from one participant: only the page proves that a page opened. */
  private observedBy(pageObserved: boolean): ObservedBuilder {
    return (verdict, additionalVerdicts = []) => ({
      pageObserved,
      verdict,
      additionalVerdicts,
    })
  }

  /** The report file once the private folder is fixed. */
  reportPath(): string | undefined {
    return this.reportPathOf()
  }

  /**
   * Judges one script against the report.
   * @param script - The announced script, with the debugger's `hash`.
   * @param scope - What the core knows about the run.
   * @returns The verdicts of the matched asset's files; `unreadable` for a report that cannot be trusted, a script without `hash` or an owned script that matches no asset; `ignore` for a foreign origin.
   * @example attribution.attribute({ url: 'http://localhost:3000/static/js/bundle.js', hash, isOwnedOrigin }, scope)
   */
  attribute(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution {
    return script.participant === 'server'
      ? this.attributeServerScript(script, scope)
      : this.attributePageScript(script, scope)
  }

  /**
   * Judges one script the server inspector parsed (Next, decision D18).
   *
   * A server script is owned when its real path lies inside a server `outputPath` a `wrapped` line announced; every other server script (Node's own, `next/dist`) is ignored, and no origin is involved. A report that is missing or unreadable here only ignores the script: owned or not cannot be told, and finalization marks the observation unreadable from the report itself. A server script never proves that a page opened.
   * @param script - The script the server session announced.
   * @param scope - What the core knows about the run.
   * @returns The verdicts of the matched asset's files; `unreadable` for an owned script without `hash` or one that matches no asset; `ignore` otherwise.
   * @example attribution.attributeServerScript({ participant: 'server', url: 'file:///app/.next/dev/server/app/page.js', hash, isOwnedOrigin }, scope)
   */
  private attributeServerScript(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution {
    const observed = this.observedBy(false)
    const identity = this.identityOf(script)
    const reportPath = this.reportPathOf()
    if (
      (identity !== undefined && this.judgedScriptIds.has(identity)) ||
      reportPath === undefined
    )
      return observed({ kind: 'ignore' })
    this.reader.refresh(reportPath)
    if (this.reader.unreadableCause !== undefined)
      return observed({ kind: 'ignore' })
    const match = this.reader.matchServer(script.url, script.hash)
    if (match.kind === 'not-owned') return observed({ kind: 'ignore' })
    // An owned script the debugger gave no hash for cannot be tied to an asset.
    if (script.hash === undefined)
      return observed({ kind: 'unreadable', cause: 'script-without-hash' })
    if (match.kind === 'matched') {
      if (identity !== undefined) this.judgedScriptIds.add(identity)
      return this.verdictsOf(match.asset.resources, scope, observed)
    }
    return this.unmatchedOwnedScript(script, observed)
  }

  /**
   * Decides what a script owned by the preload but matching no asset means: judge it again once the report's unterminated last line ended, else the observation cannot be trusted.
   * @param script - The unmatched owned script.
   * @param observed - The attribution builder of the script's participant.
   * @returns `ignore` while deferred; `unreadable` with `truncated-compilation` or `script-matches-no-asset` otherwise.
   */
  private unmatchedOwnedScript(
    script: LibraryScript,
    observed: ObservedBuilder,
  ): LibraryScriptAttribution {
    // The line that holds this script may be the one still being written: judge again after the rest was read.
    if (!this.isFinal && this.reader.pendingBytes > 0) {
      this.deferred.push(script)
      return observed({ kind: 'ignore' })
    }
    return observed({
      kind: 'unreadable',
      cause:
        this.reader.truncatedCompilations > 0
          ? 'truncated-compilation'
          : 'script-matches-no-asset',
    })
  }

  /** Judges one script the page parsed (the react-scripts rules, unchanged); see {@link WebpackReportAttribution.attribute}. */
  private attributePageScript(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution {
    if (!isOwnedScriptUrl(script))
      return { pageObserved: false, verdict: { kind: 'ignore' } }
    const observed = this.observedBy(true)
    const identity = this.identityOf(script)
    if (identity !== undefined && this.judgedScriptIds.has(identity))
      return observed({ kind: 'ignore' })
    const reportPath = this.reportPathOf()
    if (reportPath === undefined)
      return observed({ kind: 'unreadable', cause: 'report-missing' })
    this.reader.refresh(reportPath, true)
    const unreadable = this.reader.unreadableCause
    if (unreadable !== undefined)
      return observed({ kind: 'unreadable', cause: unreadable })
    // There is no source-reading fallback: a script the debugger gave no hash for cannot be tied to an asset.
    if (script.hash === undefined)
      return observed({ kind: 'unreadable', cause: 'script-without-hash' })
    const match = this.reader.match(script.url, script.hash)
    if (match.kind === 'matched') {
      if (identity !== undefined) this.judgedScriptIds.add(identity)
      return this.verdictsOf(match.asset.resources, scope, observed)
    }
    // The line that holds this script (or its public path) may be the one still being written: judge again after the rest was read.
    if (match.kind === 'not-owned') {
      if (!this.isFinal && this.reader.pendingBytes > 0) {
        this.deferred.push(script)
        return observed({ kind: 'ignore' })
      }
      // Without a usable public path every bundle script reads not-owned; remember it so finalization can tell missing evidence from a foreign script.
      if (this.reader.isUnclassifiedBundleScript(script.url))
        this.unclassifiedScriptCount += 1
      return observed({ kind: 'ignore' })
    }
    return this.unmatchedOwnedScript(script, observed)
  }

  /**
   * Why the report left parsed scripts unclassified, when it did.
   * Called by {@link WebpackLibraryRoute.finalize} after the deferred scripts were judged.
   * @returns A cause when the page parsed a bundle script and the report still holds no usable public path (`report-error: <message>` for a preload error line, `no-usable-public-path` when only unusable paths were written, `no-compilation-report` when no compilation was written); `undefined` otherwise, including a run whose page parsed no such script.
   * @example attribution.missingEvidenceCause() // => 'no-compilation-report'
   */
  missingEvidenceCause(): string | undefined {
    if (this.unclassifiedScriptCount === 0 || this.reader.hasUsablePublicPath)
      return undefined
    const errorMessage = this.reader.reportErrorCause ?? this.reader.errorCause
    if (errorMessage !== undefined) return `report-error: ${errorMessage}`
    return this.reader.compilationsRead > 0
      ? 'no-usable-public-path'
      : 'no-compilation-report'
  }

  /** Classifies the files of a matched asset: a file of the packed folder is packed, a file of another copy is another copy, anything else says nothing. */
  private verdictsOf(
    resources: readonly string[],
    scope: LibraryAttributionScope,
    observed: ObservedBuilder,
  ): LibraryScriptAttribution {
    const verdicts: LibraryScriptVerdict[] = []
    for (const file of resources) {
      if (isInsideFolder(scope.packedRoot, file))
        verdicts.push({ kind: 'packed', file })
      else if (scope.isOtherCopyFile(file))
        verdicts.push({ kind: 'other-copy', file })
    }
    return observed(verdicts[0] ?? { kind: 'ignore' }, verdicts.slice(1))
  }

  /**
   * Reads what the preload appended since the last look and waits, within the bound, for an unterminated last line to end.
   * @returns Resolves when the report ends in a complete line or the bound passed.
   * @example await attribution.settle()
   */
  async settle(): Promise<void> {
    const reportPath = this.reportPathOf()
    if (reportPath === undefined) return
    const endsAt = Date.now() + REACT_SCRIPTS_LIBRARY_REPORT_SETTLE_MS
    for (;;) {
      this.reader.refresh(reportPath)
      if (this.reader.pendingBytes === 0 || Date.now() >= endsAt) return
      await new Promise((resolve) => setTimeout(resolve, REPORT_SETTLE_POLL_MS))
    }
  }

  /**
   * Hands out the scripts deferred while the report was incomplete and stops deferring: the caller judges them now against the settled report.
   * @returns The deferred scripts.
   * @example for (const script of attribution.takeDeferred()) core.observeScript(script)
   */
  takeDeferred(): LibraryScript[] {
    this.isFinal = true
    const scripts = this.deferred
    this.deferred = []
    return scripts
  }
}

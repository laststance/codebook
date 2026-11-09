import type { Protocol } from 'devtools-protocol'

import { STATIC_PAGE_CACHE_CONTROL, STATIC_PAGE_CDN_HOSTS } from '../constants'
import type { Cdp } from '../runtimeSupport/cdp'

import { matchCdnPackageUrl } from './matchCdnPackageUrl'
import type {
  PackedFileAbsenceCause,
  PackedLibraryFiles,
} from './servePackedLibraryFile'

/** What {@link CdnImportRedirect} needs from the run. */
export type CdnImportRedirectOptions = Readonly<{
  /** The run's page session, reached through js-debug's `requestCDPProxy`. */
  cdp: Pick<Cdp, 'request' | 'on' | 'subscribe'>
  /** The declared library's package name. */
  packageName: string
  /** The packed copy's files, read through the same instance the library seal reads. */
  files: PackedLibraryFiles
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
  /** Called once per request whose path the packed build does not hold (or that leaves the packed folder); the run ends with the library refusal. */
  onPathAbsent: (path: string, cause: PackedFileAbsenceCause) => void
}>

/**
 * Serves the packed checked-out build of a declared library in place of the page's CDN import of that package.
 *
 * Why it exists: a plain page imports its library from unpkg or jsDelivr, a URL no bundler resolves, so the only place to put the checked-out build is the browser's own network layer. The redirect subscribes to `Fetch.requestPaused` before it enables `Fetch` (js-debug forwards an event only after `JsDebug.subscribe` names it, Cycle 0105 E1), answers a matching request with the packed file and lets every other request through. Created by {@link ConfiguredBrowserRun} before the page's first load for a `static-page` run that declares `library`.
 * @example
 * const redirect = new CdnImportRedirect({ cdp, packageName: 'lib', files, record, onPathAbsent })
 * await redirect.enable() // before the page's first load
 * await redirect.disable() // when the run ends, before the browser closes
 */
export class CdnImportRedirect {
  private isEnabled = false
  private continuedCount = 0
  private fulfilledCount = 0

  constructor(private readonly options: CdnImportRedirectOptions) {}

  /**
   * Starts the interception: subscribes to the paused-request event, then enables `Fetch` for the two CDN forms of the package.
   * @throws When the page session refuses the subscription or `Fetch.enable`.
   * @example await redirect.enable()
   */
  async enable(): Promise<void> {
    const { cdp, packageName } = this.options
    await cdp.subscribe(['Fetch.requestPaused'])
    cdp.on('Fetch.requestPaused', (event) => {
      this.answer(event).catch((error: unknown) =>
        this.options.record('cdn-redirect.failed', { cause: String(error) }),
      )
    })
    this.isEnabled = true
    await cdp.request('Fetch.enable', {
      patterns: STATIC_PAGE_CDN_HOSTS.map((host) => ({
        urlPattern: `https://${host.host}${host.prefix}${packageName}@*`,
        requestStage: 'Request' as const,
      })),
    })
    this.options.record('cdn-redirect.enabled', { package: packageName })
  }

  /**
   * Ends the interception; safe to call again and after the page session closed.
   * Called when the run ends, fails or is cancelled, before its browser closes.
   * @example await redirect.disable()
   */
  async disable(): Promise<void> {
    if (!this.isEnabled) return
    this.isEnabled = false
    try {
      await this.options.cdp.request('Fetch.disable', undefined)
    } catch (error) {
      // A session that is already gone has no interception left to end.
      this.options.record('cdn-redirect.disable-failed', {
        cause: String(error),
      })
    }
    this.options.record('cdn-redirect.disabled', {
      fulfilled: this.fulfilledCount,
      continued: this.continuedCount,
    })
  }

  /**
   * Judges one paused request: a matching GET is fulfilled from the packed copy, a matching request for an absent path ends the run, every other request continues unchanged.
   * @param event - The paused request.
   * @example await this.answer(event)
   */
  private async answer(
    event: Protocol.Fetch.RequestPausedEvent,
  ): Promise<void> {
    if (!this.isEnabled) return
    const { cdp, packageName, files, onPathAbsent } = this.options
    const { requestId } = event
    const match = matchCdnPackageUrl(event.request.url, packageName)
    if (match === undefined || event.request.method !== 'GET') {
      this.continuedCount++
      await cdp.request('Fetch.continueRequest', { requestId })
      return
    }
    let served: Awaited<ReturnType<PackedLibraryFiles['read']>>
    let cause: PackedFileAbsenceCause = 'absent'
    try {
      served = await files.read(match.path)
      if (served === undefined) cause = await files.absenceCause(match.path)
    } catch (error) {
      // A serving failure must not leave the paused request hanging: the browser's request fails.
      this.options.record('cdn-redirect.failed', { cause: String(error) })
      await cdp.request('Fetch.failRequest', {
        requestId,
        errorReason: 'Failed',
      })
      return
    }
    if (served === undefined) {
      this.options.record('cdn-redirect.path-absent', {
        path: match.path,
        cause,
      })
      onPathAbsent(match.path, cause)
      await cdp.request('Fetch.failRequest', {
        requestId,
        errorReason: 'BlockedByClient',
      })
      return
    }
    this.fulfilledCount++
    this.options.record('cdn-redirect.fulfilled', {
      path: match.path,
      version: match.version,
      bytes: served.body.length,
      mapInlined: served.map !== undefined,
    })
    await cdp.request('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: served.contentType },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Cache-Control', value: STATIC_PAGE_CACHE_CONTROL },
      ],
      body: served.body.toString('base64'),
    })
  }
}

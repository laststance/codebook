import { join } from 'node:path'

import { STATIC_PAGE_CDN_HOSTS } from './constants'
import {
  LibraryRoute,
  type LibraryAttribution,
  type LibraryRouteInput,
  type LibraryRunRoute,
  type LibraryScript,
  type PlannedLibrary,
} from './libraryRoute'
import { matchCdnPackageUrl } from './utils/matchCdnPackageUrl'

/**
 * Judges the scripts a plain page parsed: a CDN file of the declared package that the redirect served is a file of the packed copy; any other file of that package on a CDN is a published copy.
 * Used by {@link StaticPageLibraryRoute} as the core's attribution.
 * @example attributeStaticPageScript(script, scope) // => { pageObserved: true, verdict: { kind: 'packed', file: '/tmp/run/node_modules/lib/dist/lib.mjs' } }
 */
const STATIC_PAGE_ATTRIBUTION: LibraryAttribution = {
  attribute(script, scope) {
    let origin: string
    try {
      origin = new URL(script.url).origin
    } catch {
      return { pageObserved: false, verdict: { kind: 'ignore' } }
    }
    const pageObserved = script.isOwnedOrigin(origin)
    const request = matchCdnPackageUrl(script.url, scope.packageName)
    if (request !== undefined)
      return {
        pageObserved,
        verdict: {
          kind: 'packed',
          file: join(scope.packedRoot, ...request.path.split('/')),
        },
      }
    const isPackageOnCdn = STATIC_PAGE_CDN_HOSTS.some((host) =>
      script.url.startsWith(
        `https://${host.host}${host.prefix}${scope.packageName}@`,
      ),
    )
    return {
      pageObserved,
      verdict: isPackageOnCdn
        ? { kind: 'other-copy', file: script.url }
        : { kind: 'ignore' },
    }
  },
}

/**
 * The run side of the CDN import redirect of a `static-page` run that declares `library`: the bundler-neutral {@link LibraryRoute} with the CDN attribution.
 *
 * Why it exists: the pack route (consent, build, pack, private folder, library facts, observation of what the page loaded) is the same whatever serves the page; only how a parsed script is traced to a file differs. A plain page declares no dependency on the library, so the route plans with the `none` relation. Created by {@link ConfiguredBrowserRun} for a `static-page` run with `library`; the run calls `plan` and `prepare` before the server starts, feeds every parsed script to `observeParsedScript`, and ends with `finalize` and `dispose`.
 * @example
 * const route = new StaticPageLibraryRoute(input)
 * await route.plan(signal)
 * await route.prepare(signal)
 * route.packedLibrary() // => { packageName: 'lib', libraryRoot: '/repo/packages/lib', packedRoot: '/tmp/run/node_modules/lib' }
 */
export class StaticPageLibraryRoute
  extends LibraryRoute
  implements LibraryRunRoute
{
  private planned: PlannedLibrary | undefined

  /** @param input - The run's facts and seams; the dependency relation is fixed to `none` here. */
  constructor(input: LibraryRouteInput) {
    super({ ...input, dependencyRelation: 'none' }, STATIC_PAGE_ATTRIBUTION)
  }

  /**
   * Seam 1, before any server: checks the route, asks the learner and fixes the private folder; the plan is kept for {@link StaticPageLibraryRoute.packedLibrary}.
   * @param signal - The run's stop.
   * @param confirmTimeoutMs - How long the learner may take to answer.
   * @returns What {@link LibraryRoute.plan} fixed.
   * @throws As {@link LibraryRoute.plan}.
   * @example const planned = await route.plan(signal)
   */
  override async plan(
    signal: AbortSignal,
    confirmTimeoutMs?: number,
  ): Promise<PlannedLibrary> {
    this.planned = await super.plan(signal, confirmTimeoutMs)
    return this.planned
  }

  /**
   * Seam 3, observation: judges one script the page's debugger announced as parsed.
   * @param script - The announced script.
   * @example route.observeParsedScript({ url, scriptId, hash, isOwnedOrigin })
   */
  observeParsedScript(script: LibraryScript): void {
    this.observeScript(script)
  }

  /**
   * The packed library the redirect serves and a library stop is sealed through.
   * @returns The package name, the real checked-out folder and the packed folder; `undefined` before the route was planned.
   * @example route.packedLibrary() // => { packageName: 'lib', libraryRoot: '/repo/packages/lib', packedRoot: '/tmp/run/node_modules/lib' }
   */
  packedLibrary():
    | { packageName: string; libraryRoot: string; packedRoot: string }
    | undefined {
    const planned = this.planned
    return planned === undefined
      ? undefined
      : {
          packageName: planned.packageName,
          libraryRoot: planned.libraryRoot,
          packedRoot: planned.packedRoot,
        }
  }
}

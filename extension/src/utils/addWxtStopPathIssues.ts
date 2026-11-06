import type { z } from 'zod'

/** The `params.reason` an issue carries when a `wxt-build` stop path lies inside `node_modules`; {@link parseChromeExtensionConfiguration} turns it into `EXTENSION_BUILD_UNSUPPORTED`. */
export const WXT_STOP_OUTSIDE_PROJECT_REASON = 'stop-outside-project'

/** The part of a chrome-extension declaration this refinement reads. */
interface DeclarationUnderCheck {
  adapter: string
  stops: readonly { path: string }[]
}

/**
 * Refuses, for the `wxt-build` adapter, a stop whose source path has a `node_modules` segment, so a dependency is never a stop's project source.
 * Called as a `superRefine` of {@link chromeExtensionConfigSchema}; the unpacked adapter keeps today's rules.
 * @param declaration - The declaration after the shape checks.
 * @param context - The refinement context that receives one issue per offending stop.
 * @example
 * // stops: [{ path: 'node_modules/lib/index.js' }] => issue at ['stops', 0, 'path']
 */
export function addWxtStopPathIssues(
  declaration: DeclarationUnderCheck,
  context: z.RefinementCtx,
): void {
  if (declaration.adapter !== 'wxt-build') return
  declaration.stops.forEach((stop, index) => {
    // Any segment counts, in either separator style.
    if (!stop.path.split(/[\\/]/).includes('node_modules')) return
    context.addIssue({
      code: 'custom',
      path: ['stops', index, 'path'],
      message:
        'a wxt-build stop must be a source file of the project, outside node_modules',
      params: { reason: WXT_STOP_OUTSIDE_PROJECT_REASON },
    })
  })
}

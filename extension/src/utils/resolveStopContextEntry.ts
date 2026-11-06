import type { ExtensionStopContext } from '../chromeExtensionContracts'

import type { StaticLoadEntry } from './discoverStaticLoads'
import type { ExtensionManifest } from './readExtensionManifest'
import { resolveExtensionFile } from './resolveExtensionFile'

/**
 * Finds the file a context's static loads start from: the surface page for `page`, the manifest's `background.service_worker` for `service-worker`.
 * Called by the extension source once per context that declares a stop, for either adapter.
 * @param options.loadRoot - The folder the extension is loaded from.
 * @param options.context - The stop's context.
 * @param options.manifest - The extension's manifest.
 * @param options.surfaceHtml - The surface page's real path.
 * @returns The entry for the static-load discovery.
 * @throws `MANIFEST_SURFACE_MISSING` when the worker file is not inside the load root or does not exist.
 * @example
 * await resolveStopContextEntry({ loadRoot, context: 'page', manifest, surfaceHtml }) // => { kind: 'page', htmlPath: surfaceHtml }
 */
export async function resolveStopContextEntry(options: {
  loadRoot: string
  context: ExtensionStopContext
  manifest: ExtensionManifest
  surfaceHtml: string
}): Promise<StaticLoadEntry> {
  const { loadRoot, context, manifest, surfaceHtml } = options
  if (context === 'page') return { kind: 'page', htmlPath: surfaceHtml }
  const scriptPath = await resolveExtensionFile({
    extensionRoot: loadRoot,
    relativePath: manifest.workerPath ?? '',
    field: "The manifest's background.service_worker",
    code: 'MANIFEST_SURFACE_MISSING',
  })
  return {
    kind: 'worker',
    scriptPath,
    isModule: manifest.workerType === 'module',
  }
}

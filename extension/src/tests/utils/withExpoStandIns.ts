import * as viteDevAdapter from '../../viteDevAdapter'

/**
 * Adds the stand-ins an `expo-web-dev` run needs to the module dependencies {@link configuredRuntimeHarness} gives the run: the Expo adapter answers like the Vite stand-in (a stub app, a sealed module served at its own address), the Expo workspace read answers a fixed port, and, for a run that declares `apiServer`, the `ownedApiServer` module is the test's.
 * Why it exists: the harness models one fake adapter; an Expo run differs only by its adapter name, its package folder and the port its web script declares, so reusing the Vite stand-in keeps one fake instead of two.
 * Called by {@link configuredRuntimeHarness} for every run; returns the dependencies unchanged for any adapter but `expo-web-dev`.
 * @param options - The harness options: the adapter and the optional `apiServer` stand-in.
 * @param dependencies - The module stand-ins the harness built, which include the Vite adapter's.
 * @returns The dependencies, with the Expo ones added for an `expo-web-dev` run.
 * @example withExpoStandIns({ adapter: 'expo-web-dev' }, deps)['./expoWebDevAdapter'] // { EXPO_WEB_DEV_ADAPTER: { … } }
 */
export function withExpoStandIns(
  options: {
    adapter?: string
    apiServer?: { module: unknown }
  },
  dependencies: Record<string, unknown>,
): Record<string, unknown> {
  if (options.adapter !== 'expo-web-dev') return dependencies
  const vite = (
    dependencies['./viteDevAdapter'] as {
      VITE_DEV_ADAPTER: Record<string, unknown>
    }
  ).VITE_DEV_ADAPTER
  return {
    ...dependencies,
    // The Expo adapter keeps its own name and runs the Vite stand-in's start, seal and settle; its script matching is the stand-in's (the sealed address is a plain URL).
    './expoWebDevAdapter': {
      EXPO_WEB_DEV_ADAPTER: {
        ...vite,
        name: 'expo-web-dev',
        isScriptOfModule: viteDevAdapter.VITE_DEV_ADAPTER.isScriptOfModule,
        browserDebugFields: viteDevAdapter.VITE_DEV_ADAPTER.browserDebugFields,
      },
    },
    // The web script's port: not the API's, and not the stand-in app's own.
    './utils/assessExpoWebWorkspace': {
      assessExpoWebWorkspace: async () => ({
        installationDirectory: '/stand-in/expo',
        version: '57.0.0',
        assignments: {},
        port: 8081,
        portSource: 'the web script in package.json',
        environment: {},
      }),
    },
    ...(options.apiServer
      ? { './ownedApiServer': options.apiServer.module }
      : {}),
  }
}

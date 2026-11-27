import { join } from 'node:path'

/**
 * The compiled bootstrap a `loader: "bun"` server launch preloads into the learner's Bun (`src/bunInspectorBootstrap.ts`), resolved beside this module.
 *
 * Why this module sits at the top of `src`: it is then in the same folder as the bootstrap in both layouts, `dist/bunInspectorBootstrapPath.js` beside `dist/bunInspectorBootstrap.js` in the compiled tree, and `dist/extension.js` once the package bundles every module into one file and ships the bootstrap as its own `dist/bunInspectorBootstrap.js`. A path computed from a module in `src/utils` would leave `dist` in the bundle. Read by {@link resolveNodeServerLaunch} when a declaration names `loader: "bun"`.
 *
 * @example
 * ```ts
 * spawn(bun.executable, ['--preload', BUN_INSPECTOR_BOOTSTRAP, entry])
 * ```
 */
export const BUN_INSPECTOR_BOOTSTRAP = join(
  __dirname,
  'bunInspectorBootstrap.js',
)

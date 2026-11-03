import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

/** Matches the address webpack gives a module of the Pages server compile: an optional `webpack-internal:///`, the layer `(pages-dir-node)`, `./`, then the module path; an optional query is cut. */
const PAGES_MODULE_URL =
  /^(?:webpack-internal:\/\/\/)?\(pages-dir-node\)\/\.\/([^?#]+)(?:[?#].*)?$/

/** Matches a module path that sits in the pages folder (`pages/…` or `src/pages/…`) and keeps the part under it. */
const PAGES_FOLDER_PATH = /^(?:src\/)?pages\/(.+)$/

/**
 * Names the compiled page (`pages/index.js`) that a script address of the Pages server compile stands for, or nothing when the script is no module of the pages folder.
 *
 * Why it exists: a frame inside the data function sits in the page's own module (`webpack-internal:///(pages-dir-node)/./pages/index.tsx`) while Next's `pages-manifest.json` lists the compiled page (`pages/index.js`), so the page of a hit is read by moving from one to the other. Called by {@link readPagesRenderedPage} for the frames inside the data-function call frame.
 * @param url - A script address of a frame; `''` when the script was never announced.
 * @returns `pages/<rest>.js` for a module under `pages/` or `src/pages/` of the `(pages-dir-node)` layer, its extension (`tsx`, `ts`, `jsx`, `js`) read as `.js`; `undefined` for another layer, for `node_modules`, for a library of the project and for an empty address.
 * @example
 * pagesCompiledPathOfModuleUrl('webpack-internal:///(pages-dir-node)/./src/pages/products/[id].tsx') // => 'pages/products/[id].js'
 * pagesCompiledPathOfModuleUrl('(pages-dir-node)/./pages/index.js')                                  // => 'pages/index.js'
 * pagesCompiledPathOfModuleUrl('(pages-dir-node)/./lib/stats.js')                                    // => undefined
 */
export function pagesCompiledPathOfModuleUrl(url: string): string | undefined {
  const modulePath = PAGES_MODULE_URL.exec(url)?.[1]
  const pagePath = modulePath && PAGES_FOLDER_PATH.exec(modulePath)?.[1]
  if (!pagePath) return undefined
  const extension = NEXT_PAGES_SOURCE_EXTENSIONS.find((candidate) =>
    pagePath.endsWith(`.${candidate}`),
  )
  return extension
    ? `pages/${pagePath.slice(0, -(extension.length + 1))}.js`
    : undefined
}

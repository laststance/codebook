import { NEXT_PAGES_RENDERER_SCRIPT_PATH } from '../constants'

/**
 * Says whether a script address is Next's compiled Pages renderer, so a frame in it is a renderer frame.
 *
 * Why it exists: a Pages hit is judged by the frames of the renderer that called the data function, and the renderer is one known file of `next`, wherever the package sits (`node_modules/next`, a pnpm store path, a workspace). Called by {@link pagesDataFunctionHitVerdictOf} for every frame.
 * @param url - A script address: a `file://` URL, a path, or `''` for a script no event announced.
 * @returns `true` when the address, with backslashes read as slashes, is or ends with `/next/dist/compiled/next-server/pages.runtime.dev.js`; `false` otherwise, also for the production runtime and for the App Router's.
 * @example
 * isNextPagesRendererUrl('file:///workspace/app/node_modules/next/dist/compiled/next-server/pages.runtime.dev.js') // => true
 * isNextPagesRendererUrl('file:///workspace/app/node_modules/next/dist/compiled/next-server/app-page.runtime.dev.js') // => false
 */
export function isNextPagesRendererUrl(url: string): boolean {
  const address = url.replaceAll('\\', '/')
  return (
    address === NEXT_PAGES_RENDERER_SCRIPT_PATH ||
    address.endsWith(`/${NEXT_PAGES_RENDERER_SCRIPT_PATH}`)
  )
}
